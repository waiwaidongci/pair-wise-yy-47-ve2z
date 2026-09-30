import { useState } from 'react'
import { Alert, Badge, Button, Descriptions, Form, Input, Radio, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import type { Issue } from '../api/types'
import { countPending, hasActiveInvalidation, isBlocked, pendingRecords } from '../api/merge'

export default function RetestPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const updateIssue = useWorkspaceStore((state) => state.updateIssue)
  // 证据更新失效后回到“待复测”，已退回项也在队列中
  const queue = issues.filter((item) => ['待复测', '已退回'].includes(item.status))
  const [active, setActive] = useState<Issue | null>(queue[0] ?? null)
  const [form] = Form.useForm()

  const submit = async (values: { result: '已通过' | '已退回' | '不适用'; note: string; environment: string }) => {
    if (!active) return
    const { data } = await axios.post<Issue>(`/api/issues/${active.key}/review`, values)
    updateIssue(data)
    setActive(data)
    form.resetFields()
    message.success(`复测结果已记录：${values.result}`)
  }

  const columns: ColumnsType<Issue> = [
    {
      title: '问题',
      dataIndex: 'key',
      render: (_, record) => (
        <div>
          <Typography.Text strong>{record.key}</Typography.Text>
          <div>{record.title}</div>
          {pendingRecords(record).length > 0 && <Tag color="orange" style={{ marginTop: 2 }}>{pendingRecords(record).length} 份待确认</Tag>}
          {hasActiveInvalidation(record) && <Tag color="purple" style={{ marginTop: 2 }}>旧通过失效</Tag>}
        </div>
      ),
    },
    { title: '修复说明', dataIndex: 'fixNote', width: 230, render: (value) => value ?? '未提交' },
    { title: '环境', dataIndex: 'retestEnv', width: 190, render: (value) => value ?? '待开发提交' },
    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={value === '已退回' ? 'error' : 'orange'}>{value}</Tag> },
    { title: '阻塞', width: 80, render: (_, record) => (isBlocked(record) ? <Tag color="error">阻塞</Tag> : <span className="muted">—</span>) },
  ]

  const pendingTotal = countPending(issues)
  const current = active ? issues.find((item) => item.key === active.key) ?? active : null

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">RETEST / 复测工作台</p>
          <h1>逐项验证修复结果</h1>
          <p className="muted">复测必须记录环境和结论；退回的问题不可无痕跳过；证据更新后旧结论失效须重算。</p>
        </div>
        <Space>
          <Badge count={pendingTotal} showZero color="#d48806"><Tag color="orange" style={{ padding: '4px 12px' }}>待确认 {pendingTotal}</Tag></Badge>
          <Tag color="orange">{queue.length} 项待复测</Tag>
        </Space>
      </div>

      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="复测规则" description="键盘问题必须覆盖 Tab、Shift+Tab、Esc 和焦点返回；屏幕阅读器问题需保留截图或播报日志。断网并入的复测需先在「断网合并」页逐条采纳，状态才会重算。" />

      <div className="review-grid">
        <div className="panel">
          <div className="panel-head"><h3>复测队列</h3><span className="muted">点击选择问题</span></div>
          <Table rowKey="key" columns={columns} dataSource={queue} pagination={false} rowClassName={(record) => record.key === current?.key ? 'ant-table-row-selected' : ''} onRow={(record) => ({ onClick: () => { setActive(record); form.resetFields() } })} scroll={{ x: 820 }} />
        </div>

        <div className="panel review-box">
          <Typography.Title level={4}>{current?.key ?? '暂无可复测项'}</Typography.Title>
          {current && (
            <>
              {hasActiveInvalidation(current) && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="该问题旧的已通过结论已失效"
                  description={current.invalidations.filter((inv) => inv.active).map((inv) => `证据更新：${inv.reason}（${inv.sourcePage}），请以新证据重新复测后重算。`).join('；')}
                />
              )}
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="问题">{current.title}</Descriptions.Item>
                <Descriptions.Item label="根因">{current.rootCause}</Descriptions.Item>
                <Descriptions.Item label="修复说明">{current.fixNote ?? '未提交'}</Descriptions.Item>
                <Descriptions.Item label="复测环境">{current.retestEnv ?? '待开发提交'}</Descriptions.Item>
              </Descriptions>
              <Form form={form} layout="vertical" style={{ marginTop: 18 }} onFinish={submit} initialValues={{ result: '已通过' }}>
                <Form.Item name="result" label="复测结论" rules={[{ required: true }]}>
                  <Radio.Group><Radio.Button value="已通过">通过</Radio.Button><Radio.Button value="已退回">退回</Radio.Button><Radio.Button value="不适用">不适用</Radio.Button></Radio.Group>
                </Form.Item>
                <Form.Item name="environment" label="本次复测环境" rules={[{ required: true }]}><Input placeholder="浏览器 / 辅助技术 / 版本号" /></Form.Item>
                <Form.Item name="note" label="复测记录" rules={[{ required: true, message: '请填写可验证的复测记录' }]}><Input.TextArea rows={5} placeholder="记录实际操作、结果与证据位置" /></Form.Item>
                <Button type="primary" htmlType="submit" block>提交复测记录</Button>
              </Form>
              <Typography.Title level={5} style={{ marginTop: 20 }}>历史复测</Typography.Title>
              {current.retestRecords.length === 0 && <Typography.Text type="secondary">暂无历史记录</Typography.Text>}
              {current.retestRecords.map((record) => (
                <div className="timeline-item" key={record.id}>
                  <Space size={4} wrap>
                    <Tag color={record.result === '通过' ? 'success' : record.result === '退回' ? 'error' : 'default'}>{record.result}</Tag>
                    {record.invalidated && <Tag color="error">已失效</Tag>}
                    {record.confirmation === '待确认' && <Tag color="orange">待确认</Tag>}
                    {record.confirmation === '已驳回' && <Tag>已驳回</Tag>}
                    {record.sourcePage && <Tag color="geekblue">{record.sourcePage}</Tag>}
                  </Space>
                  <Typography.Text strong>{record.actor}</Typography.Text>
                  <div>{record.note}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.at}</Typography.Text>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
