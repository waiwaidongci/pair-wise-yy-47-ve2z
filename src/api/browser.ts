import { setupWorker } from 'msw/browser'
import { http, HttpResponse } from 'msw'
import { seedIssues } from './seed'
import type { Issue, OfflineSubmission } from './types'
import { applySubmission, decideRetest, statusFromVerdict } from './merge'

let issues = structuredClone(seedIssues)
// 已并入的提交（服务端幂等账本，重复提交只认第一次）
const seenSubmissions = new Set<string>()
// 模拟“恢复网络后仍有一次抖动”：该提交首次同步必失败，重试成功
const failOnce = new Set<string>(['OFF-FAIL-ONCE'])

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
    const verdict: '通过' | '退回' | '不适用' =
      body.result === '通过' || body.result === '已通过' ? '通过'
        : body.result === '退回' || body.result === '已退回' ? '退回'
        : '不适用'
    issue.status = statusFromVerdict(verdict)
    issue.retestEnv = body.environment
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor: '当前用户', result: verdict, note: body.note, at: '刚刚', confirmation: '已采纳' })
    // 在线复测“通过”即完成重算，解除该问题因证据更新产生的失效来源
    if (verdict === '通过') {
      issue.invalidations = issue.invalidations.map((inv) => ({ ...inv, active: false }))
      issue.history.push({ at: '刚刚', actor: '系统', action: '失效重算完成', detail: '新复测通过，旧失效来源已解除。' })
    }
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

  // 断网页面按问题编号逐条并入（幂等）
  http.post('/api/sync/submit', async ({ request }) => {
    const sub = (await request.json()) as OfflineSubmission
    if (failOnce.has(sub.submissionId)) {
      failOnce.delete(sub.submissionId)
      return HttpResponse.json({ error: '网络抖动，连接中断', recoverable: true }, { status: 503 })
    }
    if (seenSubmissions.has(sub.submissionId)) {
      return HttpResponse.json({ duplicate: true, submissionId: sub.submissionId })
    }
    const result = applySubmission(issues, sub)
    issues = result.issues
    seenSubmissions.add(sub.submissionId)
    return HttpResponse.json({ duplicate: false, outcome: result.outcome })
  }),

  // 审核员确认一条待确认复测
  http.post('/api/retest/decide', async ({ request }) => {
    const body = (await request.json()) as { issueKey: string; recordId: string; decision: '已采纳' | '已驳回' }
    if (!issues.some((issue) => issue.key === body.issueKey)) return new HttpResponse(null, { status: 404 })
    issues = decideRetest(issues, body.issueKey, body.recordId, body.decision)
    const issue = issues.find((item) => item.key === body.issueKey)
    return HttpResponse.json(issue)
  }),

  // 重置演示数据
  http.post('/api/sync/reset', () => {
    issues = structuredClone(seedIssues)
    seenSubmissions.clear()
    failOnce.add('OFF-FAIL-ONCE')
    return HttpResponse.json({ ok: true })
  }),
)

export { issues }
