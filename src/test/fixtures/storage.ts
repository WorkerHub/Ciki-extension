/**
 * storage 正文夹具 —— 除 REAL_COLOR_STORAGE 外全部是虚构示例，不含任何真实文档或真实域名。
 * 覆盖：代码宏（CDATA 含 < > &）、面板宏、表格合并与 colgroup、任务列表、
 * 嵌套列表、附件图 / 外链图 / drawio、导航宏、status 行内宏、expand 宏、页面链接。
 *
 * REAL_COLOR_STORAGE 是用户 2026-11-09 提供的 Confluence 页面 body.storage 原文：
 * 标签、属性与 style 值逐字保留，可见正文换成中性占位（不带真实文档内容）。
 * 用它把「真实页面剪藏不丢颜色」钉在真实形态上：全篇 12 处内联色，其中 11 处在
 * 文字上（红 rgb(255,0,0)、橙 rgb(255,153,0)、灰 rgb(51,51,51)），第 12 处
 * rgb(255,204,0) 包着一张图。
 */

export const SAMPLE_STORAGE = `
<h1>支付服务部署手册</h1>
<p>本文说明 <strong>支付服务</strong> 的部署步骤，含 <em>注意事项</em>、行内代码 <code>payment start</code>、
<s>旧流程</s> 与 <a href="https://example.com/runbook">外部 Runbook</a>。</p>
<p>当前状态：<ac:structured-macro ac:name="status"><ac:parameter ac:name="title">DONE</ac:parameter></ac:structured-macro>，负责人见下。</p>
<h2>1. 环境准备</h2>
<h3>1.1 依赖清单</h3>
<ac:structured-macro ac:name="code" ac:schema-version="1">
  <ac:parameter ac:name="language">java</ac:parameter>
  <ac:parameter ac:name="linenumbers">true</ac:parameter>
  <ac:plain-text-body><![CDATA[public class PaymentApplication {
    // 条件：a < b && b > 0
    public static void main(String[] args) {
        System.out.println("starting payment service");
    }
}]]></ac:plain-text-body>
</ac:structured-macro>
<p>初始化 SQL：</p>
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">sql</ac:parameter>
  <ac:plain-text-body><![CDATA[CREATE TABLE payment_order (
  id BIGINT PRIMARY KEY,
  amount DECIMAL(12,2) NOT NULL
);]]></ac:plain-text-body>
</ac:structured-macro>
<h2>2. 配置表</h2>
<table>
  <colgroup>
    <col style="width: 40%;" />
    <col style="width: 120px;" />
    <col />
  </colgroup>
  <tbody>
    <tr><th colspan="3">2026 年度配置总览</th></tr>
    <tr><th>环境</th><th>配置项</th><th>值</th></tr>
    <tr><td rowspan="2">生产</td><td>超时时间</td><td><code>3000ms</code></td></tr>
    <tr><td>重试策略</td><td>最多 3 次</td></tr>
    <tr><td>预发</td><td>超时时间</td><td><code>5000ms</code></td></tr>
  </tbody>
</table>
<h2>3. 操作步骤</h2>
<ul>
  <li>第一步：拉取镜像
    <ul>
      <li>确认版本号
        <ul><li>检查 <strong>tag</strong> 是否为最新</li></ul>
      </li>
      <li>记录镜像 ID</li>
    </ul>
  </li>
  <li>第二步：启动服务</li>
</ul>
<ol><li>先启动网关</li><li>再启动支付服务</li></ol>
<ac:task-list>
  <ac:task>
    <ac:task-id>1</ac:task-id>
    <ac:task-status>complete</ac:task-status>
    <ac:task-body>已完成数据库备份</ac:task-body>
  </ac:task>
  <ac:task>
    <ac:task-id>2</ac:task-id>
    <ac:task-status>incomplete</ac:task-status>
    <ac:task-body>待通知值班同学</ac:task-body>
  </ac:task>
</ac:task-list>
<ac:structured-macro ac:name="info">
  <ac:rich-text-body><p>部署窗口为每周三 22:00–23:00。</p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="warning">
  <ac:rich-text-body><p>生产部署必须双人复核。</p></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="expand">
  <ac:parameter ac:name="title">回滚步骤</ac:parameter>
  <ac:rich-text-body><p>回滚优先于排查。</p><ul><li>摘流量</li><li>回退镜像</li></ul></ac:rich-text-body>
</ac:structured-macro>
<ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>
<ac:structured-macro ac:name="children" />
<ac:structured-macro ac:name="drawio">
  <ac:parameter ac:name="diagramName">架构图</ac:parameter>
  <ac:parameter ac:name="border">true</ac:parameter>
</ac:structured-macro>
<p><ac:image ac:alt="架构图"><ri:attachment ri:filename="arch.png" /></ac:image></p>
<p><ac:image ac:alt="外链图"><ri:url ri:value="https://example.com/pic/flow.png" /></ac:image></p>
<p>参考资料：<ac:link><ri:page ri:content-id="63444152" ri:content-title="支付服务概览" /><ac:plain-text-link-body><![CDATA[支付服务概览]]></ac:plain-text-link-body></ac:link>；
下载 <ac:link><ri:attachment ri:filename="runbook.pdf" /><ac:link-body>部署 Runbook</ac:link-body></ac:link>。</p>
<hr />
`

/** 只有图片的最小样本：验证 ref 编号与三种图引用。 */
export const IMAGE_STORAGE = `
<p><ac:image><ri:attachment ri:filename="a.png" /></ac:image></p>
<p><ac:image><ri:attachment ri:filename="b.png" /></ac:image></p>
`

/** 一个开关都没有的极简页。 */
export const PLAIN_STORAGE = `<p>只有一段话。</p>`

/**
 * 颜色夹具（storage format 形态）：Confluence 把三种颜色都写成内联样式，
 * 混着 rgb()/hex/大写/!important 与归一不出来的 var()、font-size、border。
 * 期望：三种颜色落到契约载具上，其余声明照旧剥除。
 */
export const COLOR_STORAGE = `
<h2>颜色示例</h2>
<p>普通文字，<span style="color: rgb(222, 53, 11);">红色警告</span>，<span style="color: #1F845A; font-weight: 600;">绿色加粗</span>。</p>
<p><span style="background-color: rgb(255, 229, 143);">黄色高亮</span>与<span style="background-color: #f00;">短写高亮</span>。</p>
<p><font color="#0052cc">老式 font 颜色</font>，<span style="color: var(--accent); font-size: 18px;">没法归一的行内颜色</span>。</p>
<p style="color: rgb(0, 82, 204);">段落级颜色</p>
<table>
  <tbody>
    <tr>
      <th style="background-color: #f4f5f7; border: 1px solid #dfe1e6;">环境</th>
      <th style="background-color: rgb(222, 235, 255);">值</th>
    </tr>
    <tr>
      <td style="background-color: #fffae6!important;">生产</td>
      <td style="color: #de350b; background-color: #ffebe6;">3000ms</td>
    </tr>
  </tbody>
</table>
`

// 真实样本（body.storage 原文，正文换中性占位）：单行排布与原文一致，
// 这样标签之间的空白文本节点、&nbsp; 与 style 值都原样进管线。
export const REAL_COLOR_STORAGE = `<p><ac:image ac:width="666"><ri:attachment ri:filename="image2025-3-9_1-2-19.png" /></ac:image></p><p>占位说明一：这一行是图表下方的说明文字。</p><p><strong>占位标题甲</strong><strong>&nbsp;</strong><strong>占位标题乙</strong><strong>&nbsp;</strong><strong>占位标题丙</strong></p><p style="margin-left: 30.0px;"><strong>占位词</strong><strong>&nbsp;</strong><strong>占位标签：</strong>占位正文一<span style="color: rgb(255,0,0);"><strong>占位红字</strong></span>占位正文二<strong>占位加粗一</strong>占位正文三<span style="color: rgb(255,153,0);">占位橙字一</span></p><p style="margin-left: 30.0px;"><strong>占位词</strong><strong>&nbsp;</strong><strong>占位标签：</strong>占位正文四<span style="color: rgb(51,51,51);"><strong>占位灰字加粗一</strong>占位灰字段一<strong>占位灰字加粗二</strong>占位灰字段二</span>占位正文五<span style="color: rgb(51,51,51);">占位灰字段三</span>占位正文六<span style="color: rgb(255,153,0);">占位橙字二</span></p><p style="margin-left: 30.0px;"><strong>占位标签：</strong>占位正文七<strong>占位代码一</strong>占位正文八<strong>占位代码二</strong>占位正文九<span style="color: rgb(255,153,0);">占位橙字三</span></p><p style="margin-left: 30.0px;"><strong>占位标签：</strong>占位正文十<span style="color: rgb(255,153,0);">占位橙字四</span></p><p><strong>占位标题丁</strong><strong>&nbsp;</strong><strong>占位标题戊</strong></p><p style="margin-left: 30.0px;"><strong>占位正文十一</strong><span style="color: rgb(255,153,0);">占位橙字五</span></p><p><strong>占位标题己</strong></p><p style="margin-left: 30.0px;">占位正文十二</p><p style="margin-left: 30.0px;"><strong>占</strong><strong>位标签：</strong>占位正文十三</p><p style="margin-left: 30.0px;"><strong>占</strong><strong>位标签：</strong>占位正文十四<span style="color: rgb(255,153,0);">占位橙字六</span></p><p style="margin-left: 30.0px;"><strong>占位标签：</strong>占位正文十五</p><p style="margin-left: 30.0px;"><strong>占位标签：</strong>占位正文十六<span style="color: rgb(255,153,0);">占位橙字七</span></p><p style="margin-left: 30.0px;"><strong>占位词甲</strong><strong>：</strong>占位正文十七<span style="color: rgb(255,153,0);">占位橙字八</span></p><p style="margin-left: 30.0px;"><span style="color: rgb(255,204,0);"><ac:image ac:width="555"><ri:attachment ri:filename="image2025-6-23_14-50-36.png" /></ac:image></span></p><p><strong>占位标题庚</strong></p><p style="margin-left: 30.0px;">占位正文十八</p><p style="margin-left: 30.0px;"><ac:image ac:width="666"><ri:attachment ri:filename="image2025-6-23_15-9-55.png" /></ac:image></p><p>占位说明二：原文此处有一对中文引号 &ldquo;占位&rdquo;。</p>`
