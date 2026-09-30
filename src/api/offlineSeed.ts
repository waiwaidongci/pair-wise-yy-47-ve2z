import type { OfflinePage } from './types'

/**
 * 审核员断网时在两个站点现场采集的结果页。
 * 恢复网络后按问题编号并入，包含：
 * - 同一问题两页都新增复测（A11Y-1048）→ 两份都保留待确认，不覆盖
 * - 证据更新使旧“已通过”失效（A11Y-1052）→ 回到待复测重算
 * - 新问题并入（A11Y-1099）
 * - 重复提交（A11Y-1074）→ 两页 submissionId 相同，只认第一次
 * - 演示断点：P1-04 在模拟服务端仅失败一次，用于“从最后确认项恢复”
 */
export const offlinePageOne: OfflinePage = {
  pageId: 'page-mall',
  pageLabel: '第 1 页 · 商城 Web 现场',
  capturedAt: '09-30 09:12',
  submissions: [
    {
      submissionId: 'OFF-P1-01',
      issueKey: 'A11Y-1048',
      sourcePage: '第 1 页 · 商城 Web',
      retest: {
        actor: '李予 / 审核员',
        result: '通过',
        note: 'Tab/Shift+Tab 环绕正常，Esc 可关闭，焦点回到筛选触发按钮。',
        environment: 'Chrome 140 / 键盘 / 商城 v4.18.4',
        at: '09-30 09:05',
      },
    },
    {
      submissionId: 'OFF-P1-02',
      issueKey: 'A11Y-1052',
      sourcePage: '第 1 页 · 商城 Web',
      retest: {
        actor: '李予 / 审核员',
        result: '退回',
        note: '客服弹窗在 iOS VoiceOver 下焦点仍短暂落到 body，需补测移动端。',
        environment: 'Safari iOS 18 / VoiceOver / 商城 v4.18.4',
        at: '09-30 09:08',
      },
      evidenceUpdate: {
        newEvidence: 'https://evidence.example.com/a11y-1052-ios',
        note: '新增 iOS VoiceOver 录屏，暴露移动端焦点恢复缺陷。',
        at: '09-30 09:08',
      },
    },
    {
      submissionId: 'OFF-P1-03',
      issueKey: 'A11Y-1074',
      sourcePage: '第 1 页 · 商城 Web',
      retest: {
        actor: '李予 / 审核员',
        result: '通过',
        note: '趋势线对比度提升至 5.1:1，并提供虚线纹理与数据表切换。',
        environment: 'Safari 26 / 对比度工具 / admin-v2.7.5',
        at: '09-30 09:10',
      },
    },
    {
      submissionId: 'OFF-FAIL-ONCE',
      issueKey: 'A11Y-1083',
      sourcePage: '第 1 页 · 商城 Web',
      retest: {
        actor: '李予 / 审核员',
        result: '通过',
        note: '错误提示已接入 aria-live，税号字段 aria-describedby 播报正确。',
        environment: 'Chrome 140 / NVDA 2025 / 采购门户 v1.12.1',
        at: '09-30 09:11',
      },
    },
  ],
}

export const offlinePageTwo: OfflinePage = {
  pageId: 'page-member',
  pageLabel: '第 2 页 · 会员中心现场',
  capturedAt: '09-30 11:36',
  submissions: [
    {
      // 与第 1 页同一问题、不同现场、不同结论 → 两份都保留待确认，不能覆盖
      submissionId: 'OFF-P2-01',
      issueKey: 'A11Y-1048',
      sourcePage: '第 2 页 · 会员中心',
      retest: {
        actor: '王岭 / 审核员',
        result: '退回',
        note: '会员中心内嵌的优惠券抽屉 Esc 后焦点顺序仍错乱，与商城实现不一致。',
        environment: 'Edge 140 / 键盘 / 会员中心 v3.9.2',
        at: '09-30 11:20',
      },
    },
    {
      // 与第 1 页完全相同的 submissionId → 重复提交，只认第一次
      submissionId: 'OFF-P1-03',
      issueKey: 'A11Y-1074',
      sourcePage: '第 2 页 · 会员中心',
      retest: {
        actor: '王岭 / 审核员',
        result: '通过',
        note: '（重复提交）与第 1 页同一条提交，应被忽略。',
        environment: 'Safari 26 / 对比度工具 / admin-v2.7.5',
        at: '09-30 11:25',
      },
    },
    {
      // 断网期间新建的问题
      submissionId: 'OFF-P2-03',
      issueKey: 'A11Y-1099',
      sourcePage: '第 2 页 · 会员中心',
      evidenceUpdate: {
        newEvidence: 'https://evidence.example.com/a11y-1099',
        note: '积分明细表格无表头关联，读屏仅朗读“按钮”。',
        at: '09-30 11:30',
      },
      newIssue: {
        title: '积分明细表格缺少表头与可识别名称',
        site: '会员中心',
        version: 'v3.9',
        wcag: ['1.3.1 信息和关系', '4.1.2 名称、角色、值'],
        issueType: '语义结构',
        impact: '严重',
        affected: '积分明细 / 屏幕阅读器用户',
        reproduction: '进入会员中心-积分明细，读屏遍历表格时无法获取列标题。',
        rootCause: '表格使用 div 模拟，未使用 table/th 与 scope 关联。',
        priority: 'P1',
      },
    },
  ],
}

export const offlinePages: OfflinePage[] = [offlinePageOne, offlinePageTwo]
