---
name: test-coverage-analysis
description: 使用 test-coverage-analysis Skill 分析当前项目的测试覆盖率
---

# Test Coverage Analysis Skill

## Skill 概述

### 用途

自动分析项目测试覆盖率，追踪失败测试的责任人，生成详细的测试报告。

### 适用场景

- CI/CD 流程中的测试报告生成
- 代码审查前的测试质量检查
- 定期测试健康度监控
- 团队测试责任追踪

### 限制

- 仅支持 Vitest 测试框架（可扩展支持其他框架）
- 需要 Git 仓库环境
- 需要 pnpm/yarn/npm 包管理器
- 假设测试失败包含标准错误输出格式

---

## 工作流程

### 阶段 1：执行测试

**目标：** 运行测试并捕获完整输出

**步骤：**

1. 检查项目根目录
2. 验证测试命令配置（默认：`pnpm run test:coverage`）
3. 执行测试命令
4. 捕获标准输出和错误输出
5. 解析测试结果（通过、失败、跳过数量）

**工具：** `bash` tool

**输出：**

- 测试执行结果
- 失败测试列表
- 错误堆栈信息

---

### 阶段 2：收集 Git 信息

**目标：** 获取项目提交历史和责任人信息

**步骤：**

1. 获取当前分支和提交信息
2. 获取远程仓库 URL
3. 对每个失败测试文件执行 `git blame`
4. 获取每个文件的提交历史

**工具：** `bash` tool

**输出：**

- 当前提交信息（hash、作者、时间、消息）
- 远程仓库 URL
- 每个测试文件的最后修改者和提交记录

---

### 阶段 3：分析失败

**目标：** 解析失败测试并提取关键信息

**步骤：**

1. 解析测试输出，提取失败用例
2. 对每个失败用例提取：
   - 文件路径
   - 测试用例名称
   - 失败位置（行号）
   - 错误类型
   - 错误详情
3. 关联失败用例与提交者（使用 git blame 结果）
4. 按错误类型分类失败

**工具：** 正则表达式、字符串解析

**输出：**

- 按提交者分类的失败列表
- 按错误类型分类的失败列表
- 每个失败的详细信息

---

### 阶段 4：生成报告

**目标：** 生成结构化的 Markdown 报告

**步骤：**

1. 生成测试覆盖率概览
2. 生成 Git 提交信息摘要
3. 生成按提交者分类的失败详情
4. 生成问题分类汇总
5. 生成修复建议（按优先级）
6. 生成总结和预期修复后结果

**工具：** 模板引擎、字符串格式化

**输出：**

- Markdown 格式的完整报告
- JSON 格式的结构化数据（可选）

---

### 阶段 5：输出结果

**目标：** 保存或显示报告

**步骤：**

1. 将报告写入文件（默认：`测试报错-yyyyMMdd-HH点.md`）
2. 可选：将 JSON 数据写入文件
3. 显示报告摘要
4. 提供文件路径

**工具：** `write` tool

**输出：**

- 报告文件路径
- 报告摘要

---

## 输入参数

| 参数名        | 类型    | 必填 | 默认值                   | 描述                     |
| ------------- | ------- | ---- | ------------------------ | ------------------------ |
| `projectPath` | string  | 否   | 当前目录                 | 项目根目录路径           |
| `testCommand` | string  | 否   | `pnpm run test:coverage` | 测试执行命令             |
| `outputFile`  | string  | 否   | `测试报错-日期时间.md`   | 输出报告文件名           |
| `outputJson`  | boolean | 否   | `false`                  | 是否生成 JSON 格式数据   |
| `timeout`     | number  | 否   | `300000`                 | 测试执行超时时间（毫秒） |

---

## 输出格式

### Markdown 报告结构

```markdown
# 测试失败分析报告

**生成时间：** YYYY-MM-DD
**测试命令：** [command]
**项目：** [project-name]
**远程仓库：** [repository-url]

## 📊 测试覆盖率概览

| 指标     | 数值          |
| -------- | ------------- |
| 总测试数 | [total]       |
| 通过     | [passed]      |
| 失败     | [failed]      |
| 跳过     | [skipped]     |
| 通过率   | [percentage]% |

## Git 提交信息

| 信息类型 | 详情               |
| -------- | ------------------ |
| 当前提交 | [hash] - [message] |
| 提交者   | [name] <[email]>   |
| 提交时间 | [timestamp]        |
| 当前分支 | [branch]           |

## 失败测试详情（按提交者分类）

### [提交者姓名] <[email]>

**失败数量：** [count] ([percentage]%)

#### 提交记录

| Commit Hash | 提交信息  | 提交时间    |
| ----------- | --------- | ----------- |
| [hash]      | [message] | [timestamp] |

#### 失败测试列表

#### 文件：[file-path] ([count]个失败)

| 测试用例    | 位置   | 错误类型     | 错误详情       |
| ----------- | ------ | ------------ | -------------- |
| [test-name] | [line] | [error-type] | [error-detail] |

## 问题分类汇总

| 问题类型 | 失败数  | 占比          | 主要责任人 | 影响文件 |
| -------- | ------- | ------------- | ---------- | -------- |
| [type]   | [count] | [percentage]% | [author]   | [files]  |

## 修复建议优先级

### 🔴 高优先级（影响[count]个测试 - [percentage]%）

**问题：** [problem-name]

**责任人：** [author]

**影响文件：** [files]

**错误信息：**
```

[error-message]

````

**修复方案：**
```typescript
[fix-code]
````

## 总结

### 关键指标

| 指标       | 数值      |
| ---------- | --------- |
| 总失败数   | [total]   |
| 责任人数   | [count]   |
| 最严重问题 | [problem] |
| 最快修复   | [problem] |
| 最慢修复   | [problem] |

### 修复建议

1. [suggestion-1]
2. [suggestion-2]
3. [suggestion-3]

### 预期修复后

| 指标   | 当前       | 修复后 |
| ------ | ---------- | ------ |
| 通过率 | [current]% | 100%   |
| 失败数 | [current]  | 0      |

````

### JSON 数据结构（可选）

```json
{
  "timestamp": "2026-03-13T14:44:00Z",
  "project": {
    "name": "MatrixAssistant",
    "path": "/path/to/project",
    "repository": "https://gitcode.com/SmallScarred/MatrixAssistant.git"
  },
  "test": {
    "command": "pnpm run test:coverage",
    "total": 672,
    "passed": 579,
    "failed": 75,
    "skipped": 18,
    "passRate": 86.16
  },
  "git": {
    "currentCommit": {
      "hash": "e6d6684",
      "message": "添加功能：推荐问题，Demo程序",
      "author": "SmallScarred",
      "email": "SmallScarred@noreply.gitcode.com",
      "timestamp": "2026-03-12T19:45:09+0800"
    },
    "branch": "dev"
  },
  "failures": {
    "byAuthor": [
      {
        "author": "我是管小亮_V0x3f",
        "email": "504897664@qq.com",
        "count": 42,
        "percentage": 56.0,
        "commits": [
          {
            "hash": "ca4b26e8",
            "message": "feat: 初始化 MatrixAssistant 项目结构",
            "timestamp": "2026-02-16T22:47:28+0800"
          }
        ],
        "failures": [
          {
            "file": "tests/unit/message-utils.test.ts",
            "test": "should return \"just now\" for recent timestamps",
            "line": 250,
            "errorType": "AssertionError",
            "errorDetail": "expected '2026-03-13 14:26' to be 'just now'"
          }
        ]
      }
    ],
    "byErrorType": [
      {
        "type": "TypeError: storage.setItem is not a function",
        "count": 60,
        "percentage": 80.0,
        "authors": ["我是管小亮_V0x3f", "developer_yl"],
        "files": ["update.test.ts", "multi-window-theme-sync.test.ts", "stores.test.ts"]
      }
    ]
  },
  "recommendations": [
    {
      "priority": "high",
      "problem": "Zustand Storage Mock",
      "count": 60,
      "percentage": 80.0,
      "authors": ["我是管小亮_V0x3f", "developer_yl"],
      "files": ["update.test.ts", "multi-window-theme-sync.test.ts", "stores.test.ts"],
      "fix": "在测试文件中正确 mock localStorage"
    }
  ]
}
````

---

## 模板和示例

### 报告模板

使用以下模板生成报告：

```typescript
const reportTemplate = `# 测试失败分析报告

**生成时间：** ${timestamp}
**测试命令：** ${testCommand}
**项目：** ${projectName}
**远程仓库：** ${repositoryUrl}

${generateCoverageSection()}
${generateGitSection()}
${generateFailuresByAuthorSection()}
${generateErrorTypeSummarySection()}
${generateRecommendationsSection()}
${generateSummarySection()}
`;
```

### 使用示例

#### 示例 1：基本使用

```
用户：分析当前项目的测试覆盖率

执行流程：
1. 加载 test-coverage-analysis Skill
2. 使用默认参数执行
3. 生成报告到 测试报错-日期时间.md
4. 显示报告摘要
```

#### 示例 2：自定义参数

```
用户：分析测试覆盖率，输出到 test-report.md，并生成 JSON 数据

执行流程：
1. 加载 test-coverage-analysis Skill
2. 使用参数：
   - outputFile: "test-report.md"
   - outputJson: true
3. 生成报告到 test-report.md
4. 生成 JSON 数据到 test-report.json
5. 显示报告摘要
```

#### 示例 3：指定项目路径

```
用户：分析 /path/to/project 的测试覆盖率

执行流程：
1. 加载 test-coverage-analysis Skill
2. 使用参数：
   - projectPath: "/path/to/project"
3. 切换到指定目录
4. 执行测试分析
5. 生成报告
```

#### 示例 4：自定义测试命令

```
用户：使用 npm test 运行测试并分析

执行流程：
1. 加载 test-coverage-analysis Skill
2. 使用参数：
   - testCommand: "npm test"
3. 执行自定义测试命令
4. 分析结果
5. 生成报告
```

---

## 最佳实践

### 如何处理大型项目

**问题：** 大型项目测试数量多，执行时间长

**解决方案：**

1. **并行执行：**
   - 将测试套件拆分为多个文件
   - 并行执行多个测试命令
   - 合并结果

2. **增量分析：**
   - 只分析最近修改的文件
   - 使用 Git diff 获取变更文件
   - 只运行相关测试

3. **缓存机制：**
   - 缓存 Git blame 结果
   - 缓存提交历史
   - 减少重复查询

```typescript
// 示例：增量分析
const changedFiles = await getChangedFiles();
const testFiles = changedFiles.filter((f) => f.endsWith('.test.ts'));
const testCommand = `pnpm vitest run ${testFiles.join(' ')}`;
```

### 如何自定义分析规则

**问题：** 需要根据项目特点自定义错误分类

**解决方案：**

1. **定义规则文件：**

   ```yaml
   # .test-analysis-analysis.yml
   rules:
     - name: 'Storage Mock Issue'
       pattern: 'storage.setItem is not a function'
       priority: 'high'
       fix: 'Mock localStorage in test files'

     - name: 'Timeout Issue'
       pattern: 'Test timed out'
       priority: 'medium'
       fix: 'Increase timeout or optimize test'
   ```

2. **加载规则：**
   ```typescript
   const rules = loadRules('.test-analysis-rules.yml');
   const failures = parseTestOutput(output);
   const classified = classifyFailures(failures, rules);
   ```

### 如何集成到 CI/CD

**问题：** 需要在 CI/CD 流程中自动生成测试报告

**解决方案：**

#### GitHub Actions

```yaml
# .github/workflows/test-report.yml
name: Test Coverage Analysis

on:
  pull_request:
  push:
    branches: [main, dev]

jobs:
  test-analysis:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: pnpm install

      - name: Run test analysis
        run: |
          # 使用 Skill 执行分析
          node scripts/run-test-analysis.js

      - name: Upload report
        uses: actions/upload-artifact@v3
        with:
          name: test-report
          path: 测试报错-日期时间.md

      - name: Comment on PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const report = fs.readFileSync('测试报错-日期时间.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

#### GitLab CI

```yaml
# .gitlab-ci.yml
test-analysis:
  stage: test
  script:
    - pnpm install
    - pnpm run test:coverage
    - node scripts/run-test-analysis.js
  artifacts:
    paths:
      - 测试报错-日期时间.md
    reports:
      junit: test-results.xml
  only:
    - merge_requests
    - main
    - dev
```

#### GitCode CI

```yaml
# .gitcode-ci.yml
stages:
  - name: test-analysis
    jobs:
      - name: run-analysis
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v3
          - name: Install dependencies
            run: pnpm install
          - name: Run test analysis
            run: node scripts/run-test-analysis.js
          - name: Upload report
            uses: actions/upload-artifact@v3
            with:
              name: test-report
              path: 测试报错-日期时间.md
```

### 如何处理多语言项目

**问题：** 项目包含多种语言的测试

**解决方案：**

1. **检测项目类型：**

   ```typescript
   const projectType = detectProjectType(projectPath);

   const analyzers = {
     javascript: new VitestAnalyzer(),
     typescript: new VitestAnalyzer(),
     python: new PytestAnalyzer(),
     java: new JUnitAnalyzer(),
     go: new GoTestAnalyzer(),
   };

   const analyzer = analyzers[projectType];
   ```

2. **统一接口：**
   ```typescript
   interface TestAnalyzer {
     run(command: string): Promise<TestResult>;
     parse(output: string): Failure[];
     getGitBlame(file: string): Promise<GitInfo>;
   }
   ```

---

## 常见问题

### Q: 如何跳过某些测试？

**A:** 在测试命令中添加 `--skip` 参数：

```bash
pnpm run test:coverage --skip slow-tests
```

或者在 Skill 参数中配置：

```typescript
const testCommand = 'pnpm run test:coverage --skip slow-tests';
```

### Q: 如何只分析失败的测试？

**A:** Vitest 默认只显示失败的测试。如果需要只运行失败的测试：

```bash
pnpm run test:coverage --reporter=verbose --bail
```

### Q: 如何生成历史趋势报告？

**A:** 实现历史数据存储和对比：

```typescript
// 1. 保存当前结果
const currentResult = await analyzeTestCoverage();
await saveResult(currentResult, 'test-results/latest.json');

// 2. 加载历史结果
const previousResult = await loadResult('test-results/previous.json');

// 3. 生成趋势报告
const trendReport = generateTrendReport(previousResult, currentResult);
```

### Q: 如何自动创建修复 PR？

**A:** 集成 Git API：

```typescript
// 1. 分析失败
const failures = await analyzeTestCoverage();

// 2. 生成修复代码
const fixes = await generateFixes(failures);

// 3. 创建分支并提交
const branch = `fix/test-failures-${Date.now()}`;
await createBranch(branch);
await commitFixes(fixes, branch);

// 4. 创建 PR
await createPullRequest({
  title: 'Fix test failures',
  body: generatePRDescription(failures),
  branch: branch,
  base: 'main',
});
```

---

## 扩展性

### 支持其他测试框架

**Jest:**

```typescript
class JestAnalyzer implements TestAnalyzer {
  parse(output: string): Failure[] {
    // Jest 输出格式解析
  }
}
```

**Mocha:**

```typescript
class MochaAnalyzer implements TestAnalyzer {
  parse(output: string): Failure[] {
    // Mocha 输出格式解析
  }
}
```

**Pytest:**

```typescript
class PytestAnalyzer implements TestAnalyzer {
  parse(output: string): Failure[] {
    // Pytest 输出格式解析
  }
}
```

### 自定义报告格式

**HTML 报告:**

```typescript
function generateHtmlReport(data: AnalysisData): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Report</title>
      </head>
      <body>
        <h1>Test Coverage: ${data.test.passRate}%</h1>
        <!-- 更多内容 -->
      </body>
    </html>
  `;
}
```

**PDF 报告:**

```typescript
import { PDFDocument } from 'pdf-lib';

async function generatePdfReport(data: AnalysisData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  // 生成 PDF 内容
  return await pdfDoc.save();
}
```

---

## 版本历史

| 版本  | 日期       | 变更             |
| ----- | ---------- | ---------------- |
| 1.0.0 | 2026-03-13 | 初始版本         |
| 1.1.0 | 待定       | 支持其他测试框架 |
| 1.2.0 | 待定       | 历史趋势分析     |
| 1.3.0 | 待定       | 自动修复建议     |

---

## 维护者

- 创建者：Specialist
- 贡献者：[待添加]

---

## 许可证

Apache-2.0
