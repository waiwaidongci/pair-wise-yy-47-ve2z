export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type RetestRecord = {
  id: string
  actor: string
  result: string
  note: string
  at: string
  /** 离线并入后尚未被审核员采纳的复测记录 */
  pending?: boolean
  /** 证据更新后被标记失效的原通过记录 */
  invalidated?: boolean
  /** 记录来源的离线页标识，如「离线页 A」 */
  source?: string
}

export type Issue = {
  key: string
  title: string
  site: string
  version: string
  wcag: string[]
  issueType: string
  impact: '致命' | '严重' | '中等' | '轻微'
  affected: string
  reproduction: string
  evidence: string
  rootCause: string
  status: IssueStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  team: string
  owner: string
  dueDate: string
  mergedKeys: string[]
  fixNote?: string
  retestEnv?: string
  retestRecords: RetestRecord[]
  history: Array<{ at: string; actor: string; action: string; detail: string }>
  /** 证据最近一次更新时间，用于判定通过结论是否失效 */
  evidenceUpdatedAt?: string
  /** 失效来源说明，如「证据更新于 09-30 10:12，原通过结论失效」 */
  invalidatedReason?: string
}

/** 审核员断网时导出、恢复网络后带回合并的离线页快照 */
export type OfflinePackage = {
  format: 'a11y-offline-page'
  page: string
  exportedAt: string
  exportedBy: string
  issues: Issue[]
}

/** 离线并入批次：用于幂等去重与失败后从最后确认项恢复 */
export type ImportBatch = {
  id: string
  at: string
  pages: string[]
  status: 'done' | 'failed'
  totalItems: number
  confirmedKeys: string[]
  pendingAdded: number
}
