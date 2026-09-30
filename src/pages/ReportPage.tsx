import { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Select, Space, Tag, Typography, message } from 'antd'
import { DownloadOutlined, FilePdfOutlined } from '@ant-design/icons'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { countBlocked, countPending, isBlocked, pendingRecords } from '../api/merge'

export default function ReportPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const draft = useWorkspaceStore((state) => state.draft)
  const setDraft = useWorkspaceStore((state) => state.setDraft)
  const [site, setSite] = useState('全部站点')
  const [includeEvidence, setIncludeEvidence] = useState(true)
  const [includeHistory, setIncludeHistory] = useState(true)
  const visible = issues.filter((item) => site === '全部站点' || item.site === site)

  const pendingTotal = countPending(visible)
  const blockedTotal = countBlocked(visible)
  const activeInvalidations = useMemo(
    () => visible.flatMap((issue) => issue.invalidations.filter((inv) => inv.active).map((inv) => ({ issue, inv }))),
    [visible],
  )

  // 报告草稿：证据更新产生失效时自动追加失效来源，供撰写人核对
  const autoDraftLines = activeInvalidations.map(
    ({ issue, inv }) => `【失效来源】${issue.key} 因证据更新（${inv.reason}）旧已通过 ${inv.recordId} 已失效，状态回到待复测，需重算后方可计入通过。来源：${inv.sourcePage}。`,
  )

  const exportCsv = () => {
    const rows = [
      ['编号', '站点', '版本', '问题', 'WCAG', '影响', '状态', '待确认数量', '是否阻塞', '失效来源', '团队', '负责人', '截止日期'],
      ...visible.map((issue) => [
        issue.key,
        issue.site,
        issue.version,
        issue.title,
        issue.wcag.join(' / '),
        issue.impact,
        issue.status,
        String(pendingRecords(issue).length),
        isBlocked(issue) ? '阻塞' : '',
        issue.invalidations.filter((inv) => inv.active).map((inv) => `${inv.sourcePage}:${inv.recordId}`).join(' / '),
        issue.team,
        issue.owner,
        issue.dueDate,
      ]),
      [],
      ['汇总', `待确认 ${pendingTotal} 份`, `阻塞项 ${blockedTotal} 个`, `失效来源 ${activeInvalidations.length} 条`],
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `无障碍整改报告-${site}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success('报告已导出，含待确认数量与阻塞项列')
  }

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">REPORT / 整改报告</p>
          <h1>可追溯的站点整改报告</h1>
          <p className="muted">按站点、版本和状态汇总问题；失效来源、待确认数量与阻塞项在正文和导出中均可见。</p>
        </div>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportCsv}>导出 CSV</Button>
          <Button type="primary" icon={<FilePdfOutlined />} onClick={() => window.print()}>打印 / PDF</Button>
        </Space>
      </div>

      <div className="panel" style={{ padding: 12, marginBottom: 14 }}>
        <Space wrap>
          <span>报告范围</span>
          <Select value={site} onChange={setSite} style={{ width: 150 }} options={['全部站点', ...new Set(issues.map((item) => item.site))].map((value) => ({ value }))} />
          <Checkbox checked={includeEvidence} onChange={(event) => setIncludeEvidence(event.target.checked)}>包含证据链接</Checkbox>
          <Checkbox checked={includeHistory} onChange={(event) => setIncludeHistory(event.target.checked)}>包含操作历史</Checkbox>
        </Space>
      </div>

      {(pendingTotal > 0 || blockedTotal > 0) && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`当前范围存在 ${pendingTotal} 份待确认复测、${blockedTotal} 个阻塞项，报告口径尚未定稿`}
          description="阻塞项包含待确认复测，以及证据更新后旧已通过失效、尚待重算的问题。请先在「断网合并」页处理。"
        />
      )}

      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <Typography.Title level={5}>报告草稿</Typography.Title>
        <Input.TextArea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
        {autoDraftLines.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>系统已根据证据更新标出失效来源：</Typography.Text>
            {autoDraftLines.map((line) => (
              <div key={line} className="invalidation-draft-line">
                <Tag color="error">失效来源</Tag>
                <Typography.Text style={{ fontSize: 12 }}>{line}</Typography.Text>
              </div>
            ))}
          </div>
        )}
      </div>

      <article className="panel report-sheet">
        <header style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px solid #173e4d', paddingBottom: 16 }}>
          <div><Typography.Text type="secondary">数字体验无障碍治理项目</Typography.Text><h2>网站无障碍整改报告</h2><Typography.Text>生成日期：2026-09-30 · WCAG 2.2 AA</Typography.Text></div>
          <div style={{ textAlign: 'right' }}>
            <Tag color="blue">{site}</Tag>
            <div>问题 {visible.length} 项</div>
            <div>通过 {visible.filter((item) => item.status === '已通过').length} 项</div>
            <div style={{ color: '#d48806' }}>待确认 {pendingTotal} 份</div>
            <div style={{ color: '#cf1322' }}>阻塞 {blockedTotal} 项</div>
          </div>
        </header>
        <table>
          <thead><tr><th>编号</th><th>页面 / 范围</th><th>问题与 WCAG</th><th>影响</th><th>状态 / 责任</th><th>待确认 / 阻塞</th><th>截止</th></tr></thead>
          <tbody>
            {visible.map((issue) => (
              <tr key={issue.key} className={isBlocked(issue) ? 'row-blocked' : ''}>
                <td>{issue.key}</td>
                <td>{issue.site}<br /><Typography.Text type="secondary">{issue.version}</Typography.Text></td>
                <td>
                  <strong>{issue.title}</strong><br />
                  {issue.wcag.join(' / ')}
                  {includeEvidence && <><br /><Typography.Link href={issue.evidence}>查看证据</Typography.Link></>}
                  {issue.invalidations.some((inv) => inv.active) && (
                    <div style={{ marginTop: 3 }}>
                      <Tag color="error">旧通过失效</Tag>
                      {issue.invalidations.filter((inv) => inv.active).map((inv) => (
                        <Typography.Text key={inv.id} type="danger" style={{ fontSize: 11 }}>{inv.sourcePage} · {inv.recordId}</Typography.Text>
                      ))}
                    </div>
                  )}
                </td>
                <td><Tag color={issue.impact === '致命' ? 'red' : issue.impact === '严重' ? 'volcano' : 'gold'}>{issue.impact}</Tag></td>
                <td>{issue.status}<br />{issue.team} / {issue.owner}</td>
                <td>
                  {pendingRecords(issue).length > 0 && <Tag color="orange">{pendingRecords(issue).length} 待确认</Tag>}
                  {isBlocked(issue) && <Tag color="error">阻塞</Tag>}
                  {!isBlocked(issue) && '—'}
                </td>
                <td>{issue.dueDate}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {activeInvalidations.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <Typography.Title level={5}>失效来源（证据更新后旧已通过立即失效并重算）</Typography.Title>
            {activeInvalidations.map(({ issue, inv }) => (
              <div className="timeline-item" key={inv.id}>
                <strong>{issue.key} · {issue.title}</strong>
                <div>{inv.reason}</div>
                <div style={{ fontSize: 12 }}>
                  <Typography.Text delete type="secondary">{inv.evidenceBefore}</Typography.Text>
                  {' → '}
                  <Typography.Link href={inv.evidenceAfter} target="_blank">{inv.evidenceAfter}</Typography.Link>
                </div>
                <span className="muted">{inv.sourcePage} · 旧结论 {inv.recordId} · {inv.at}</span>
              </div>
            ))}
          </div>
        )}

        {includeHistory && <div style={{ marginTop: 20 }}><Typography.Title level={5}>最近操作记录</Typography.Title>{visible.flatMap((issue) => issue.history.slice(-1).map((event) => <div className="timeline-item" key={`${issue.key}-${event.at}`}><strong>{issue.key} · {event.action}</strong><div>{event.detail}</div><span className="muted">{event.actor} · {event.at}</span></div>))}</div>}
      </article>
    </section>
  )
}
