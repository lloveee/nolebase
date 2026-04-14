# AI Hedge Fund

> AI 驱动的对冲基金概念验证，教育目的，不构成任何投资建议。

## 概述

多个 AI Agent 协同工作，做出交易决策：

| Agent | 风格 |
|---|---|
| Warren Buffett Agent | 追求合理价格下的优质公司 |
| Ben Graham Agent | 价值投资之父，只买有安全边际的隐藏宝石 |
| Charlie Munger Agent | 巴菲特搭档，合理价格买优秀企业 |
| Michael Burry Agent | 大空头，逆向价值猎手 |
| Peter Lynch Agent | 追求十倍股 |
| Cathie Wood Agent | 成长投资女王 |
| Bill Ackman Agent | 激进投资者 |
| Nassim Taleb Agent | 黑天鹅风险分析师 |
| Stanley Druckenmiller Agent | 宏观传奇 |
| Aswath Damodaran Agent | 估值专家 |
| Mohnish Pabrai Agent | Dhandho 投资者 |
| Phil Fisher Agent | 成长投资，深度调研 |
| Rakesh Jhunjhunwala Agent | 印度大牛 |
| Valuation Agent | 计算内在价值，生成交易信号 |
| Sentiment Agent | 分析市场情绪 |
| Fundamentals Agent | 分析基本面数据 |
| Technicals Agent | 分析技术指标 |
| Risk Manager | 计算风险指标，设置仓位限制 |
| Portfolio Manager | 最终交易决策，生成订单 |

> ⚠️ 注意：系统**不会进行真实交易**。

## Web 应用界面

![Web UI](https://github.com/user-attachments/assets/b95ab696-c9f4-416c-9ad1-51feb1f5374b)

## 命令行界面

![CLI](https://github.com/user-attachments/assets/e8ca04bf-9989-4a7d-a8b4-34e04666663b)

## 快速开始

### 安装

```bash
git clone https://github.com/virattt/ai-hedge-fund.git
cd ai-hedge-fund
cp .env.example .env
# 编辑 .env 添加 API Key
```

### 运行

**命令行：**
```bash
poetry install
poetry run python src/main.py --ticker AAPL,MSFT,NVDA
```

**Web 应用：**
```bash
cd app
# 见 app/README.md 详细说明
```

### 回测
```bash
poetry run python src/backtester.py --ticker AAPL,MSFT,NVDA
```

---

> 免责声明：本项目仅供教育研究目的，不构成投资建议，不对任何金融损失负责。
