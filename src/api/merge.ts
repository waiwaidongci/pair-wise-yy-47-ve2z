import dayjs from 'dayjs'
import type {
  ApplyOutcome,
  Issue,
  IssueStatus,
  OfflineSubmission,
  RetestRecord,
  RetestVerdict,
} from './types'

export const now = () => dayjs().format('MM-DD HH:mm')

/** 复测表单结论到问题状态的归一化映射（兼容复测口径“退回/通过”与表单口径“已退回/已通过”） */
export function statusFromVerdict(verdict: RetestVerdict | string): IssueStatus {
  if (verdict === '通过' || verdict === '已通过') return '已通过'
  if (verdict === '退回' || verdict === '已退回') return '已退回'
  if (verdict === '不适用') return '不适用'
  return verdict as IssueStatus
}

/** 是否已经见过同一提交（重复提交只认第一次） */
export function isSeen(issues: Issue[], submissionId: string): boolean {
  return issues.some((issue) =>
    issue.retestRecords.some((record) => record.submissionId === submissionId) ||
    issue.history.some((event) => event.detail.includes(submissionId)),
  )
}

/**
 * 将一条断网提交按问题编号并入台账。
 * 纯函数：返回新的 issues 数组与结果，不覆盖任何已有复测记录。
 */
export function applySubmission(
  issues: Issue[],
  sub: OfflineSubmission,
): { issues: Issue[]; outcome: ApplyOutcome } {
  if (isSeen(issues, sub.submissionId)) {
    return { issues, outcome: { type: 'duplicate', submissionId: sub.submissionId, issueKey: sub.issueKey } }
  }

  const stamp = sub.evidenceUpdate?.at ?? sub.retest?.at ?? now()
  const existing = issues.find((issue) => issue.key === sub.issueKey)

  // 断网期间新建的问题
  if (!existing && sub.newIssue) {
    const seed: Issue = {
      key: sub.issueKey,
      title: sub.newIssue.title,
      site: sub.newIssue.site,
      version: sub.newIssue.version,
      wcag: sub.newIssue.wcag,
      issueType: sub.newIssue.issueType,
      impact: sub.newIssue.impact,
      affected: sub.newIssue.affected,
      reproduction: sub.newIssue.reproduction,
      evidence: '',
      rootCause: sub.newIssue.rootCause,
      status: '待分配',
      priority: sub.newIssue.priority,
      team: '待分配',
      owner: '待分配',
      dueDate: '待定',
      mergedKeys: [],
      retestRecords: [],
      invalidations: [],
      history: [
        { at: stamp, actor: sub.retest?.actor ?? '审核员', action: '断网新建并入', detail: `来自断网页 ${sub.sourcePage}（${sub.submissionId}）` },
      ],
    }
    const withEvidence = sub.evidenceUpdate ? { ...seed, evidence: sub.evidenceUpdate.newEvidence } : seed
    const withRetest = sub.retest
      ? attachRetest(withEvidence, sub, true)
      : withEvidence
    return { issues: [...issues, withRetest], outcome: { type: 'new-issue', issueKey: sub.issueKey } }
  }

  if (!existing) {
    return { issues, outcome: { type: 'noop', issueKey: sub.issueKey } }
  }

  let issue: Issue = { ...existing }
  let invalidated = false
  let invalidationId: string | undefined

  // 证据更新：旧的“已通过”立即失效并回到待复测重算（待确认记录不视为已生效结论）
  if (sub.evidenceUpdate) {
    const passedRecord = [...issue.retestRecords]
      .reverse()
      .find((record) => record.result === '通过' && record.confirmation === '已采纳' && !record.invalidated)
    issue = {
      ...issue,
      evidence: sub.evidenceUpdate.newEvidence,
      invalidations: passedRecord
        ? [
            ...issue.invalidations,
            {
              id: `INV-${sub.submissionId}`,
              reason: sub.evidenceUpdate.note,
              evidenceBefore: issue.evidence,
              evidenceAfter: sub.evidenceUpdate.newEvidence,
              recordId: passedRecord.id,
              at: sub.evidenceUpdate.at,
              sourcePage: sub.sourcePage,
              active: true,
            },
          ]
        : issue.invalidations,
      retestRecords: passedRecord
        ? issue.retestRecords.map((record) => (record.id === passedRecord.id ? { ...record, invalidated: true } : record))
        : issue.retestRecords,
      history: [
        ...issue.history,
        {
          at: sub.evidenceUpdate.at,
          actor: sub.retest?.actor ?? '审核员',
          action: '证据更新',
          detail: `${sub.evidenceUpdate.note}（证据 ${issue.evidence} → ${sub.evidenceUpdate.newEvidence}）`,
        },
      ],
    }
    if (passedRecord) {
      invalidated = true
      invalidationId = `INV-${sub.submissionId}`
      issue = { ...issue, status: '待复测' as IssueStatus }
      issue.history.push({
        at: sub.evidenceUpdate.at,
        actor: '系统',
        action: '已通过失效',
        detail: `证据更新后旧结论 ${passedRecord.id} 失效，回到待复测重算（${sub.submissionId}）`,
      })
    }
  }

  // 新增复测：不覆盖已有记录，统一进入待确认
  if (sub.retest) {
    issue = attachRetest(issue, sub, true)
  }

  const next = issues.map((item) => (item.key === issue.key ? issue : item))
  if (invalidated && invalidationId) {
    return { issues: next, outcome: { type: 'invalidated', issueKey: issue.key, invalidationId } }
  }
  if (sub.retest) {
    return { issues: next, outcome: { type: 'retest', issueKey: issue.key, recordId: `RT-${sub.submissionId}`, pending: true } }
  }
  return { issues: next, outcome: { type: 'noop', issueKey: issue.key } }
}

function attachRetest(issue: Issue, sub: OfflineSubmission, pending: boolean): Issue {
  if (!sub.retest) return issue
  const record: RetestRecord = {
    id: `RT-${sub.submissionId}`,
    actor: sub.retest.actor,
    result: sub.retest.result,
    note: sub.retest.note,
    at: sub.retest.at,
    submissionId: sub.submissionId,
    sourcePage: sub.sourcePage,
    confirmation: pending ? '待确认' : '已采纳',
  }
  const next: Issue = {
    ...issue,
    retestEnv: sub.retest.environment,
    retestRecords: [...issue.retestRecords, record],
    history: [
      ...issue.history,
      {
        at: sub.retest.at,
        actor: sub.retest.actor,
        action: `断网复测并入（${record.result}）`,
        detail: `${sub.retest.note} · 来自 ${sub.sourcePage}（${sub.submissionId}）待确认`,
      },
    ],
  }
  return next
}

/** 确认一条待确认复测：采纳则按结论重算状态，驳回则保留记录但不改状态 */
export function decideRetest(
  issues: Issue[],
  issueKey: string,
  recordId: string,
  decision: '已采纳' | '已驳回',
  actor = '当前用户',
): Issue[] {
  return issues.map((issue) => {
    if (issue.key !== issueKey) return issue
    const record = issue.retestRecords.find((item) => item.id === recordId)
    if (!record || record.confirmation !== '待确认') return issue

    const retestRecords = issue.retestRecords.map((item) =>
      item.id === recordId ? { ...item, confirmation: decision } : item,
    )
    let status = issue.status
    let invalidations = issue.invalidations
    if (decision === '已采纳') {
      status = statusFromVerdict(record.result)
      // 采纳新的“通过”结论即完成重算，该问题的失效来源解除
      if (record.result === '通过') {
        invalidations = invalidations.map((inv) => ({ ...inv, active: false }))
      }
    }
    return {
      ...issue,
      retestRecords,
      invalidations,
      status,
      history: [
        ...issue.history,
        {
          at: now(),
          actor,
          action: decision === '已采纳' ? '采纳断网复测' : '驳回断网复测',
          detail: `${decision} ${record.id}（${record.result}，${record.sourcePage ?? '在线'}）${decision === '已采纳' && record.result === '通过' ? '，旧失效来源已重算解除' : ''}`,
        },
      ],
    }
  })
}

// ---------- 选择器 / 统计 ----------

export function pendingRecords(issue: Issue) {
  return issue.retestRecords.filter((record) => record.confirmation === '待确认')
}

export function hasActiveInvalidation(issue: Issue) {
  return issue.invalidations.some((item) => item.active)
}

/** 阻塞项：存在待确认复测（同一问题两页都新增时各算一份），或证据更新导致旧已通过失效尚待复测重算 */
export function isBlocked(issue: Issue): boolean {
  return pendingRecords(issue).length > 0 || hasActiveInvalidation(issue)
}

export function countPending(issues: Issue[]): number {
  return issues.reduce((sum, issue) => sum + pendingRecords(issue).length, 0)
}

export function countBlocked(issues: Issue[]): number {
  return issues.filter(isBlocked).length
}
