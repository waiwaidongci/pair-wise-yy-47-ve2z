import assert from 'node:assert/strict'
import { seedIssues } from '../src/api/seed'
import { offlinePageOne, offlinePageTwo } from '../src/api/offlineSeed'
import { applySubmission, countBlocked, countPending, decideRetest, isBlocked, pendingRecords } from '../src/api/merge'
import type { Issue } from '../src/api/types'

let issues: Issue[] = structuredClone(seedIssues)
const seen: string[] = []

// 模拟“恢复网络后逐条并入两页”，重复提交按 isSeen 跳过（与 MSW 幂等口径一致）
for (const page of [offlinePageOne, offlinePageTwo]) {
  for (const sub of page.submissions) {
    const result = applySubmission(issues, sub)
    if (result.outcome.type !== 'duplicate') issues = result.issues
    else seen.push(sub.submissionId)
  }
}

const byKey = (key: string) => issues.find((i) => i.key === key)!

// 1. 同一问题两页都新增复测 → 两份都保留待确认，不覆盖
const i1048 = byKey('A11Y-1048')
assert.equal(pendingRecords(i1048).length, 2, '1048 应有两份待确认')
assert.equal(i1048.status, '修复中', '待确认未采纳前不改状态')
assert.ok(isBlocked(i1048), '1048 应阻塞')

// 2. 证据更新 → 旧“已通过”失效，回到待复测
const i1052 = byKey('A11Y-1052')
assert.equal(i1052.status, '待复测', '1052 失效后应回到待复测')
assert.equal(i1052.invalidations.length, 1)
assert.equal(i1052.invalidations[0].active, true)
assert.equal(i1052.retestRecords.find((r) => r.id === 'RT-22')?.invalidated, true)
assert.equal(i1052.evidence, 'https://evidence.example.com/a11y-1052-ios')

// 3. 重复提交只认第一次：1074 只有 1 条记录
const i1074 = byKey('A11Y-1074')
assert.equal(i1074.retestRecords.length, 1, '1074 重复提交应被忽略')
assert.deepEqual(seen, ['OFF-P1-03'])

// 4. 新问题并入
const i1099 = byKey('A11Y-1099')
assert.ok(i1099, '1099 应被新建')
assert.equal(i1099.status, '待分配')

// 5. 待确认 / 阻塞统计：1048(2) 1052(1) 1074(1) 1083(1) = 5；阻塞问题 1048/1052/1074/1083 = 4
assert.equal(countPending(issues), 5)
assert.equal(countBlocked(issues), 4)

// 6. 采纳 1048 第 1 页“通过” → 状态重算为已通过；第 2 页驳回仍保留
const passRec = i1048.retestRecords.find((r) => r.submissionId === 'OFF-P1-01')!
const rejectRec = i1048.retestRecords.find((r) => r.submissionId === 'OFF-P2-01')!
issues = decideRetest(issues, 'A11Y-1048', passRec.id, '已采纳', '审核员')
issues = decideRetest(issues, 'A11Y-1048', rejectRec.id, '已驳回', '审核员')
assert.equal(byKey('A11Y-1048').status, '已通过', '采纳通过后应重算为已通过')
assert.equal(pendingRecords(byKey('A11Y-1048')).length, 0, '处理后无待确认')
assert.equal(byKey('A11Y-1048').retestRecords.length, 2, '驳回记录仍保留，不覆盖')

// 7. 1052 先采纳“退回”不解除失效；再模拟一次通过复测采纳 → 失效解除
const backRec = i1052.retestRecords.find((r) => r.submissionId === 'OFF-P1-02')!
issues = decideRetest(issues, 'A11Y-1052', backRec.id, '已采纳', '审核员')
assert.equal(byKey('A11Y-1052').status, '已退回')
assert.equal(byKey('A11Y-1052').invalidations[0].active, true, '退回不解除失效')
assert.ok(!isBlocked(byKey('A11Y-1048')), '1048 两份处理完应解除阻塞')

// 8. 同一提交二次并入 → duplicate，不产生新记录（重复提交只认第一次）
const again = applySubmission(issues, offlinePageOne.submissions[0])
assert.equal(again.outcome.type, 'duplicate')
assert.equal(again.issues, issues, '重复并入应原样返回，不改数据')

// 9. 再补一条“通过”复测并采纳 → 失效来源解除、状态回到已通过、不再阻塞
const passAgain: import('../src/api/types').OfflineSubmission = {
  submissionId: 'OFF-P3-01',
  issueKey: 'A11Y-1052',
  sourcePage: '第 3 页 · 复测补测',
  retest: { actor: '李予', result: '通过', note: 'iOS VoiceOver 修复后焦点正确返回。', environment: 'iOS 18 / VoiceOver', at: '09-30 15:00' },
}
issues = applySubmission(issues, passAgain).issues
const rec = byKey('A11Y-1052').retestRecords.find((r) => r.submissionId === 'OFF-P3-01')!
issues = decideRetest(issues, 'A11Y-1052', rec.id, '已采纳', '审核员')
assert.equal(byKey('A11Y-1052').status, '已通过', '补测通过采纳后应重算为已通过')
assert.equal(byKey('A11Y-1052').invalidations.every((inv) => !inv.active), true, '失效来源应解除')
assert.ok(!isBlocked(byKey('A11Y-1052')), '重算后应解除阻塞')

console.log('全部断言通过 ✔')
