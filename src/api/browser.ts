import { setupWorker } from 'msw/browser'
import { http, HttpResponse } from 'msw'
import { seedIssues } from './seed'
import type { ImportBatch, Issue, OfflinePackage } from './types'
import { applyEvidenceUpdate, applyRecordDecision, computeBatchId, mergePackagesIntoIssues, nowLabel } from './offlineMerge'

let issues = structuredClone(seedIssues)

/** 已处理的离线并入批次：重复批次只认第一次 */
const batches = new Map<string, ImportBatch>()

function totalItemsOf(packages: OfflinePackage[]): number {
  return new Set(packages.flatMap((pkg) => pkg.issues.map((issue) => issue.key))).size
}

export const worker = setupWorker(
  http.get('/api/issues', ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const status = url.searchParams.get('status') ?? ''
    const site = url.searchParams.get('site') ?? ''
    const filtered = issues.filter((issue) => (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) && (!status || issue.status === status) && (!site || issue.site === site))
    return HttpResponse.json(filtered)
  }),
  http.post('/api/issues/:key/review', async ({ params, request }) => {
    const issue = issues.find((item) => item.key === params.key)
    const body = (await request.json()) as { result: string; note: string; environment: string }
    if (!issue) return new HttpResponse(null, { status: 404 })
    issue.status = body.result as Issue['status']
    issue.retestEnv = body.environment
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor: '当前用户', result: body.result, note: body.note, at: '刚刚' })
    issue.history.push({ at: '刚刚', actor: '当前用户', action: `复测${body.result}`, detail: body.note })
    return HttpResponse.json(issue)
  }),
  http.post('/api/issues/bulk-assign', async ({ request }) => {
    const body = (await request.json()) as { keys: string[]; team: string; owner: string; dueDate: string; priority: string }
    issues = issues.map((issue) =>
      body.keys.includes(issue.key)
        ? { ...issue, team: body.team, owner: body.owner, dueDate: body.dueDate, priority: body.priority as Issue['priority'], status: '修复中', history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '批量分配', detail: `指派至 ${body.team} / ${body.owner}` }] }
        : issue,
    )
    return HttpResponse.json({ updated: body.keys.length })
  }),
  http.post('/api/issues/:key/evidence', async ({ params, request }) => {
    const issue = issues.find((item) => item.key === params.key)
    const body = (await request.json()) as { evidence: string }
    if (!issue) return new HttpResponse(null, { status: 404 })
    const index = issues.findIndex((item) => item.key === params.key)
    const updated = applyEvidenceUpdate(issue, body.evidence, nowLabel())
    issues[index] = updated
    return HttpResponse.json(updated)
  }),
  http.post('/api/issues/:key/retest/confirm', async ({ params, request }) => {
    const issue = issues.find((item) => item.key === params.key)
    const body = (await request.json()) as { recordId: string; adopt: boolean }
    if (!issue) return new HttpResponse(null, { status: 404 })
    const index = issues.findIndex((item) => item.key === params.key)
    const updated = applyRecordDecision(issue, body.recordId, body.adopt, nowLabel())
    issues[index] = updated
    return HttpResponse.json(updated)
  }),
  http.post('/api/offline/import', async ({ request }) => {
    const body = (await request.json()) as { packages: OfflinePackage[]; failAfter?: number }
    if (!Array.isArray(body.packages) || body.packages.length === 0) {
      return HttpResponse.json({ error: '缺少离线页文件' }, { status: 400 })
    }
    const batchId = computeBatchId(body.packages)
    const existing = batches.get(batchId)
    if (existing) {
      return HttpResponse.json({ duplicate: true as const, batch: existing, issues })
    }

    const totalItems = totalItemsOf(body.packages)
    const previousIssues = issues
    const outcome = mergePackagesIntoIssues(issues, body.packages)
    const failAfter = typeof body.failAfter === 'number' ? body.failAfter : Number.POSITIVE_INFINITY
    const appliedBeforeFailure = outcome.appliedKeys.slice(0, failAfter)
    const failed = appliedBeforeFailure.length < outcome.appliedKeys.length

    if (failed) {
      // 失败回滚：只保留失败点之前已确认项的改动，未处理项（含新增问题）一律不并入
      const confirmed = new Set(appliedBeforeFailure)
      issues = outcome.issues
        .map((mergedIssue) => (confirmed.has(mergedIssue.key) ? mergedIssue : previousIssues.find((item) => item.key === mergedIssue.key) ?? mergedIssue))
        .filter((issue) => !(outcome.newKeys.includes(issue.key) && !confirmed.has(issue.key)))
    } else {
      issues = outcome.issues
    }

    const previousIds = new Map(previousIssues.map((item) => [item.key, new Set(item.retestRecords.map((record) => record.id))]))
    const pendingAdded = appliedBeforeFailure.reduce((sum, key) => {
      const merged = outcome.issues.find((item) => item.key === key)
      if (!merged) return sum
      const existed = previousIds.get(key) ?? new Set<string>()
      return sum + merged.retestRecords.filter((record) => record.pending && !existed.has(record.id)).length
    }, 0)

    const batch: ImportBatch = {
      id: batchId,
      at: nowLabel(),
      pages: body.packages.map((pkg) => pkg.page),
      status: failed ? 'failed' : 'done',
      totalItems,
      confirmedKeys: appliedBeforeFailure,
      pendingAdded,
    }
    batches.set(batchId, batch)
    return HttpResponse.json({ duplicate: false as const, batch, issues })
  }),
  http.post('/api/offline/resume', async ({ request }) => {
    const body = (await request.json()) as { batchId: string; packages: OfflinePackage[] }
    let batch = batches.get(body.batchId)
    if (batch?.status === 'done') return HttpResponse.json({ duplicate: true as const, batch, issues })

    const outcome = mergePackagesIntoIssues(issues, body.packages)
    issues = outcome.issues
    const resumed: ImportBatch = batch
      ? {
          ...batch,
          status: 'done',
          confirmedKeys: Array.from(new Set([...batch.confirmedKeys, ...outcome.appliedKeys])),
          pendingAdded: batch.pendingAdded + outcome.pendingAdded,
        }
      : {
          // 服务端批次记录已随 worker 重启丢失：并入本身幂等，直接补记为已完成
          id: body.batchId,
          at: nowLabel(),
          pages: body.packages.map((pkg) => pkg.page),
          status: 'done',
          totalItems: totalItemsOf(body.packages),
          confirmedKeys: outcome.appliedKeys,
          pendingAdded: outcome.pendingAdded,
        }
    batches.set(resumed.id, resumed)
    return HttpResponse.json({ duplicate: false as const, batch: resumed, issues })
  }),
)

export { issues }
