# Changelog

All notable changes to this project are documented here. The public version line starts at 1.0.0.

## 1.0.0 - 2026-10-30

首个公开发布.

- CSS 内联化: `<style>` 与 class 规则全部写进元素 `style`, class/id/script 全部移除
- 微信白名单清洗: 标签改名 (div -> section 等), 不支持的 CSS (flex/grid/position/transform/动画/伪元素/@media) 移除并逐项报告
- 注入级联: 直写编辑器 body 优先, 350ms 延时样式校验, 失败自动换 `execCommand` 重试, 绕过微信对 execCommand 插入内容剥内联样式的清洗
- 图片: 文件夹模式按相对路径匹配本地图片, 串行上传到素材库 (后台未公开接口), 失败降级为占位框
- 零安装复制页: `extension/copy-page.html`, 不装扩展也能完成 清洗 -> 复制 -> 粘贴
- 预览稿识别: `*-preview.html` 与含 "预览" 的稿排到最后, 同分取修改时间最新
- 诊断: 插入结果带方式与样式计数, 一键复制诊断信息
- 测试: `npm test` 14 项, 自包含 fixtures, 含模拟微信剥样式的敌对编辑器用例
