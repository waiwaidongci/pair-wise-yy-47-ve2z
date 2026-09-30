import type { ImportBatch, Issue, OfflinePackage, RetestRecord } from './types'

/** 统一时间标签：MM-DD HH:mm */
export function nowLabel(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function recordPassed(result: string): boolean {
  return result === '通过' || result === '已通过'
}

export function recordRejected(result: string): boolean {
  return result === '退回' || result === '已退回'
}

/** 由离线页内容派生批次号：同一批文件重复并入只认第一次 */
export function computeBatchId(packages: OfflinePackage[]): string {
  const raw = packages
    .slice()
    .sort((a, b) => a.page.localeCompare(b.page, 'zh'))
    .map(
      (pkg) =>
        `${pkg.page}|${pkg.exportedAt}|${pkg.exportedBy}|${pkg.issues
          .map((issue) => `${issue.key}:${issue.retestRecords.map((record) => record.id).sort().join(',')}`)
          .sort()
          .join(';')}`,
    )
    .join('||')
  let hash = 5381
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0
  }
  return `BATCH-${hash.toString(36).toUpperCase()}`
}

export type MergeOutcome = {
  issues: Issue[]
  /** 本次实际并入（含新增记录或新增问题）的问题编号，按处理顺序 */
  appliedKeys: string[]
  /** 新增的待确认复测记录条数 */
  pendingAdded: number
  /** 离线页中本地不存在、新增进台账的问题编号 */
  newKeys: string[]
}

/**
 * 按问题编号把离线页并入台账。
 * - 已有记录绝不覆盖：只追加本地不存在的复测记录；
 * - 同一问题在多个离线页都有新复测时，各页记录全部保留并标记待确认；
 * - 离线页带来的新问题整项加入，其复测记录同样待确认。
 */
export function mergePackagesIntoIssues(issues: Issue[], packages: OfflinePackage[]): MergeOutcome {
  const result: Issue[] = issues.map((issue) => ({ ...issue, retestRecords: [...issue.retestRecords], history: [...issue.history] }))
  const appliedKeys: string[] = []
  const newKeys: string[] = []
  let pendingAdded = 0

  for (const pkg of packages) {
    for (const incoming of pkg.issues) {
      const target = result.find((issue) => issue.key === incoming.key)
      if (!target) {
        const newIssue: Issue = {
          ...structuredClone(incoming),
          retestRecords: incoming.retestRecords.map((record) => ({ ...record, pending: true, source: record.source ?? pkg.page })),
          history: [
            ...incoming.history,
            { at: nowLabel(), actor: '当前用户', action: '离线并入', detail: `来自离线页「${pkg.page}」的新问题，整项待确认` },
          ],
        }
        result.push(newIssue)
        newKeys.push(incoming.key)
        appliedKeys.push(incoming.key)
        pendingAdded += newIssue.retestRecords.length
        continue
      }

      const existingIds = new Set(target.retestRecords.map((record) => record.id))
      const newRecords: RetestRecord[] = incoming.retestRecords
        .filter((record) => !existingIds.has(record.id))
        .map((record) => ({ ...record, pending: true, source: record.source ?? pkg.page }))
      if (newRecords.length === 0) continue

      target.retestRecords.push(...newRecords)
      target.history.push({
        at: nowLabel(),
        actor: '当前用户',
        action: '离线并入',
        detail: `从离线页「${pkg.page}」并入 ${newRecords.length} 条复测记录，待审核员确认`,
      })
      pendingAdded += newRecords.length
      if (!appliedKeys.includes(target.key)) appliedKeys.push(target.key)
    }
  }

  return { issues: result, appliedKeys, pendingAdded, newKeys }
}

/** 证据更新：已通过结论立即失效，重算为待复测并标记失效来源 */
export function applyEvidenceUpdate(issue: Issue, evidence: string, at: string): Issue {
  const updated: Issue = { ...issue, evidence, evidenceUpdatedAt: at }
  if (issue.status === '已通过') {
    updated.status = '待复测'
    updated.invalidatedReason = `证据更新于 ${at}，原通过结论失效，需按新证据重测`
    let passedMarked = false
    updated.retestRecords = issue.retestRecords.map((record) => {
      if (!passedMarked && recordPassed(record.result) && !record.invalidated) {
        passedMarked = true
        return { ...record, invalidated: true }
      }
      return record
    })
    updated.history = [
      ...issue.history,
      { at, actor: '当前用户', action: '证据更新导致通过失效', detail: '证据链接变更，原已通过状态立即失效，重算为待复测，等待按新证据复测' },
    ]
  } else {
    updated.history = [...issue.history, { at, actor: '当前用户', action: '证据更新', detail: '证据链接已更新' }]
  }
  return updated
}

/** 审核员采纳 / 忽略一条待确认的离线复测记录 */
export function applyRecordDecision(issue: Issue, recordId: string, adopt: boolean, at: string): Issue {
  const record = issue.retestRecords.find((item) => item.id === recordId)
  if (!record || !record.pending) return issue

  if (!adopt) {
    return {
      ...issue,
      retestRecords: issue.retestRecords.filter((item) => item.id !== recordId),
      history: [
        ...issue.history,
        { at, actor: '当前用户', action: '忽略离线复测', detail: `未采纳离线页「${record.source ?? '未知'}」的复测记录 ${record.id}` },
      ],
    }
  }

  const nextStatus: Issue['status'] = recordPassed(record.result) ? '已通过' : recordRejected(record.result) ? '已退回' : '不适用'
  return {
    ...issue,
    status: nextStatus,
    invalidatedReason: undefined,
    retestRecords: issue.retestRecords.map((item) => (item.id === recordId ? { ...item, pending: false } : item)),
    history: [
      ...issue.history,
      {
        at,
        actor: '当前用户',
        action: '采纳离线复测',
        detail: `采纳离线页「${record.source ?? '未知'}」的复测结论「${record.result}」，状态重算为${nextStatus}`,
      },
    ],
  }
}

export type PendingEntry = { issue: Issue; record: RetestRecord }

/** 所有待确认复测记录（离线并入、尚未采纳） */
export function selectPendingEntries(issues: Issue[]): PendingEntry[] {
  return issues.flatMap((issue) => issue.retestRecords.filter((record) => record.pending).map((record) => ({ issue, record })))
}

/** 阻塞项：存在待确认复测记录、结论尚未落定的问题 */
export function selectBlockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.retestRecords.some((record) => record.pending))
}

/** 失效项：证据更新导致原通过结论失效的问题 */
export function selectInvalidatedIssues(issues: Issue[]): Issue[] {
  return issues.filter((issue) => Boolean(issue.invalidatedReason))
}

export function summarizeBatches(batches: ImportBatch[]): { done: number; failed: number } {
  return batches.reduce(
    (acc, batch) => {
      if (batch.status === 'done') acc.done += 1
      if (batch.status === 'failed') acc.failed += 1
      return acc
    },
    { done: 0, failed: 0 },
  )
}
