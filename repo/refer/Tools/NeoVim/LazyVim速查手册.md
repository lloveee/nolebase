# LazyVim 速查手册

> LazyVim 是基于 LazyVim 的 Neovim 配置，集成了大量插件。本笔记覆盖核心快捷键、插件功能与最佳实践。

---

## 基础概念

- **Normal Mode** = 普通模式（默认），按 `i` 进入插入模式，`Esc` 返回
- **Leader** = 空格键 `<Space>`，大多数自定义快捷键以 leader 开头
- **Window** = 窗口，**Tab** = Tab 页，一个 tab 可包含多个 window

---

## 移动与搜索

| 快捷键 | 功能 |
|---|---|
| `h j k l` | 左下上右（也可用方向键） |
| `w` / `b` | 向前/后跳一个词 |
| `W` / `B` | 跳过标点，以空白字符分词 |
| `0` / `$` | 行首/行尾 |
| `^` | 行首（忽略缩进） |
| `gg` / `G` | 文件开头/结尾 |
| `<C-d>` / `<C-u>` | 向下/上翻半页 |
| `<C-f>` / `<C-b>` | 向下/上翻整页 |
| `{` / `}` | 段落间跳转 |
| `%` | 跳转匹配括号 |
| `f{char}` / `F{char}` | 当前行向右/左找字符，按 `;` 重复 |
| `*` / `#` | 搜索光标下词（向下/向上） |
| `/` | 全局搜索 |
| `?` | 反向全局搜索 |
| `n` / `N` | 搜索下一个/上一个 |

###  Telescope 搜索（模糊查找）

| 快捷键 | 功能 |
|---|---|
| `<leader>fr` | 打开最近文件（Frecent Files） |
| `<leader>ff` | 搜索文件（Find Files） |
| `<leader>fg` | 全局内容搜索（Grep） |
| `<leader>fb` | 搜索当前 Buffer |
| `<leader>fh` | 搜索 Help 文档 |
| `<leader>fH` | 搜索 Colorscheme |
| `<leader>fk` | 搜索 Keymaps |
| `<leader>fm` | 搜索 Maps（所有映射） |
| `<leader>fo` | 搜索 Vim Options |
| `<leader>ft` | 搜索 Todos |
| `<leader>fc` | 搜索 Neovim 配置 |
| `<leader>gc` | Git Commits |
| `<leader>gs` | Git Status |
| `<leader>gb` | Git Blame（行级提交历史） |

###  导航面板

| 快捷键 | 功能 |
|---|---|
| `<leader>e` | 打开文件资源管理器（NeoTree） |
| `<leader>ge` | 同上，但聚焦在文件上而非目录 |
| `<leader>sw` | 打开 Snippet 计算器（Word Count） |
| `<leader>ss` | 打开 Telescope 命令面板 |

---

## 编辑操作

###  插入与修改

| 快捷键 | 功能 |
|---|---|
| `i` / `a` | 光标前/后进入插入模式 |
| `I` / `A` | 行首/行尾进入插入模式 |
| `o` / `O` | 当前行下/上方插入空行并进入插入 |
| `s` / `S` | 删除光标下字符/整行并进入插入 |
| `c` + 动作 | 删除指定范围并进入插入（如 `ciw` 改词） |
| `C` | 删除光标到行尾并进入插入 |
| `r` / `R` | 替换单个字符/进入替换模式 |
| `~` | 大小写切换 |
| `gu` / `gU` | 转小写/大写 |
| `.` | 重复上次编辑 |

###  删除、复制、粘贴

| 快捷键 | 功能 |
|---|---|
| `x` / `X` | 删除光标后/前字符 |
| `d` + 动作 | 删除指定范围（如 `dw`, `di{`, `da(`） |
| `dd` | 删除整行 |
| `D` | 删除到行尾 |
| `y` + 动作 | 复制（yank） |
| `yy` / `Y` | 复制整行 |
| `p` / `P` | 粘贴到光标后/前 |
| `"+y` / `"+p` | 系统剪贴板粘贴/复制（跨应用） |
| `cc` | 删除整行并进入插入 |

###  多光标与块操作

| 快捷键 | 功能 |
|---|---|
| `<C-n>` | 多光标选中下一个匹配词（Terminator） |
| `<C-x>` | 跳过当前匹配，继续选下一个 |
| `gn` / `gN` | 向后/前选中下一个匹配并进入可视模式 |
| `vf` + 范围 | 选中配对符号内（如 `vaf`, `vac`） |
| `<C-v>` | 进入列块可视化模式（Visual Block） |
| `I` / `A` | 在列块模式下，列内所有行同时编辑 |

###  缩进与格式化

| 快捷键 | 功能 |
|---|---|
| `>>` / `<<` | 右/左缩进当前行 |
| `==` | 自动格式化当前行（如果是 LSP） |
| `=ap` | 格式化当前段落 |
| `gg=G` | 格式化整个文件 |
| `:Format` | 格式化当前 Buffer（LSP） |
| `:FormatInfo` | 查看文件使用的格式化程序 |

---

## 文件与 Buffer

| 快捷键 | 功能 |
|---|---|
| `:w` | 保存 |
| `:q` | 关闭当前 |
| `:qa` | 关闭所有 |
| `:wq` / `:x` | 保存并关闭 |
| `:qa!` | 强制关闭所有（不保存） |
| `<C-w>q` | 关闭窗口 |
| `<C-w>s` / `:sp` | 水平分屏 |
| `<C-w>v` / `:vs` | 垂直分屏 |
| `<C-w>h/j/k/l` | 切换到左/下/上/右窗口 |
| `<C-w>w` | 在窗口间循环切换 |
| `<C-w>o` | 只保留当前窗口 |
| `<C-w>r` / `H` `J` `K` `L` | 移动窗口 |
| `<C-w>=` | 所有窗口等宽等高 |
| `<C-^>` | 切换到上一个文件（Alternate File） |

###  Buffer Line（Buffer 切换）

| 快捷键 | 功能 |
|---|---|
| `]b` / `[b` | 下一个/上一个 Buffer |
| `<leader>bd` | 删除当前 Buffer |
| `<leader>bo` | 关闭其他 Buffer |
| `<leader>bl` | 删除所有 Buffer |
| `<leader>bb` | 切换到上一个 Buffer |

---

## LSP（语言服务）

| 快捷键 | 功能 |
|---|---|
| `gd` | 跳转到定义（Go to Definition） |
| `gD` | 跳转到声明（Declaration） |
| `gr` | 列出所有引用（References） |
| `gi` | 列出实现（Implementations） |
| `gy` | 跳转到类型定义（Type Definition） |
| `K` | 显示悬停文档（Hover） |
| `<leader>ca` | 显示可用 Code Action（修复建议） |
| `<leader>cr` | 重命名符号（Rename） |
| `[e` / `]e` | 跳转到上一个/下一个错误 |
| `[d` / `]d` | 跳转到上一个/下一个诊断 |
| `<leader>cd` | 显示行内诊断 |
| `<leader>ci` | 显示诊断信息 |

---

## Git（LazyVim 内置 gitsigns）

| 快捷键 | 功能 |
|---|---|
| `]c` / `[c` | 跳转到下一个/上一个 Commit |
| `<leader>gs` | Git Status |
| `<leader>gc` | Git Commits |
| `<leader>gb` | Git Blame |
| `<leader>gp` | Git Push |
| `<leader>gl` | Git Pull |
| `gs` | Git Status（Telescope） |
| `<leader>gg` | Lazygit（终端 UI） |
| `<leader>gd` | Git Diff（可视化） |

---

## 其他常用

| 快捷键 | 功能 |
|---|---|
| `u` | 撤销（Undo） |
| `<C-r>` | 重做（Redo） |
| `<leader>h` | 切换到上一个 Holder（undo tree） |
| `<leader>H` | 切换到下一个 Holder |
| `<leader>ur` | 恢复最近关闭的文件（Undo Rescue） |
| `<leader>w` | 快速保存（which-key 快捷键） |
| `z=` | 拼写建议 |
| `<leader>uC` | 配色方案切换（随机） |
| `<leader>uS` | 主题切换 |
| `<leader>ut` | 切换透明背景 |
| `<leader>un` | 取消HlSearch 高亮 |
| `<leader>l` | 关闭诊断（与 LSP 联用） |

---

## 折叠

| 快捷键 | 功能 |
|---|---|
| `zc` | 关闭折叠 |
| `zo` | 打开折叠 |
| `zM` | 关闭所有折叠 |
| `zR` | 打开所有折叠 |
| `za` | 切换当前折叠 |
| `zf` | 手动创建折叠 |

---

## 宏（Macro）

| 快捷键 | 功能 |
|---|---|
| `q{register}` | 开始录制宏到指定寄存器 |
| `q` | 结束录制 |
| `@{register}` | 执行寄存器中的宏 |
| `@@` | 重复上次宏 |
| `{n}@{register}` | 执行 n 次宏 |

---

## 最佳实践

### 1. 高效移动
- **尽量用 `w/b` 而非 `h/l`**：减少手指移动
- **配合数字前缀**：`3w` 跳3个词，`5j` 下移5行
- **使用 Text Objects**：`ci"`, `da(`, `yi{` 比手动删除更精准

### 2. 编辑效率
- **`ciw` + 新内容 + `Esc`**：改词，比 `dw i Esc` 快
- **块操作**：`<C-v>` 列选 → `I` → 批量输入 → `Esc`：`Ctrl+v` 批量在多行行首加注释
- **点范（Dot Formula）**：用 `.` 重复，所以每次操作尽量做到"一步到位"

### 3. 搜索替换
- **可视模式选中文本** → `/` 自动搜索选中内容
- **`:s/foo/bar/g`**：当前行全局替换
- **`:%s/foo/bar/g`**：全文替换
- **`:'<,'>s/foo/bar/g`**：选中区域替换

### 4. 窗口管理
- **`C-w H/J/K/L`**：直接移动窗口到左/下/上/右，而不是单纯切换
- **`:sp` / `:vs`**：经常用分屏对比两个文件
- **`<C-w>o`**：阅读代码时只留一个窗口，减少干扰

### 5. Telescope 技巧
- 搜索时 **`C-n/C-p`** 上下选择
- **`C-j/C-k`** 也能上下移动
- **`C-f`** 预览区翻页
- **`C-z`** 标记多个文件，然后 **`C-x`** 批量打开

### 6. Git 协作
- **`gb`** blame 特别适合查某行是谁改的
- **`[c/]c`** 在 git diff 模式下跳转修改块
- **`Lazygit`**（`<leader>gg`）比命令行 git 更直观

### 7. LSP 配合
- **重命名**：光标在符号上时用 `<leader>cr`，自动改所有引用，比手动全局替换靠谱
- **Code Action**：`<leader>ca` 能自动 import、修复 lint 错误
- **Type Hint**：光标在函数调用上时 `K` 看类型签名

---

## 常见问题

### Q: 如何自定义快捷键？
编辑 `~/.config/nvim/lua/plugins/` 下的配置，或新建 `lua/plugins/user.lua`。

### Q: 插件不工作怎么办？
1. `:Mason` 检查 LSP/DAP/Linter 安装状态
2. `:Lazy` 查看插件加载情况，看有没有报错
3. `:checkhealth` 检查 Neovim 运行环境

### Q: 如何禁用某个内置插件？
在 `lua/plugins/` 新建文件：
```lua
return {
  "nvim-treesitter/nvim-treesitter-textobjects",
  enabled = false,
}
```

### Q: 配色方案在哪换？
- `:Lazy` → 搜索 `formatter` → 可视化切换
- `<leader>uC` 随机切换

### Q: LazyVim 更新后配置报错？
```bash
cd ~/.config/nvim
git stash
git pull
git stash pop
nvim
```
遇到插件冲突 → `:Lazy sync`

---

## 资源链接

- [LazyVim 官方文档](https://lazyvim.org)
- [Neovim 官方文档](https://neovim.io/doc)
- [Telescope 扩展](https://github.com/nvim-telescope/telescope.nvim)
- [Lazy 插件管理器](https://github.com/folke/lazy.nvim)
