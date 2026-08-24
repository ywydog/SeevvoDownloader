<div align="center">
  <h1>SeevvoDownloader</h1>
  <p>希沃全家桶一键下载安装工具 — 基于 Tauri 2 + Vue 3 重构</p>

![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)
![License](https://img.shields.io/badge/license-GPLv3-green.svg)

</div>

## 项目简介

SeevvoDownloader 是一款专门为希沃相关软件打造的下载管理工具，旨在简化希沃软件的获取和安装过程。通过直观的图形界面，用户可以轻松选择并批量下载所需的希沃软件，无需逐个访问官方网站查找下载链接。

本项目基于 Tauri 2 + Vue 3 + Naive UI 重构，采用 aria2 下载内核（多连接分段、断点续传），并借鉴现代下载管理器的架构与美学设计。

## 功能特性

* **软件中心**：希沃全家桶软件清单，多选/全选/分类浏览

* **多下载源**：支持多个 GitHub 加速源切换（香港/CloudFlare/EdgeOne/Geekertao）

* **批量下载**：基于 aria2 引擎，支持多连接分段下载与断点续传

* **批量安装**：支持静默安装（/S）与压缩包自动解压

* **下载管理**：任务列表、进度/速度显示、历史记录

* **自更新**：启动时自动检测版本更新

## 支持的软件

涵盖希沃全系列软件及常用工具：剪辑师、希沃白板5、希沃管家、希沃快传、ClassIsland2、ClassWidgets、微信、QQ 等。

## 开发

```bash
# 安装前端依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建
pnpm tauri build
```

## 技术栈

* **桌面框架**：Tauri 2 (Rust)

* **前端**：Vue 3 + TypeScript + Pinia + Naive UI

* **下载内核**：aria2（多连接分段、断点续传）

* **解压**：内置 zip/7z 解压能力

## 许可证

本项目采用 **GNU General Public License v3.0** 许可证。

## 免责声明

* **仅供学习研究**：本工具仅用于学习和研究目的

* **非商业用途**：请勿用于商业用途

* **资源来源**：所有软件资源均来源于官方或公开渠道

* **侵权处理**：如有侵权，请联系作者删除

* **责任自负**：使用本工具产生的任何后果由用户自行承担

