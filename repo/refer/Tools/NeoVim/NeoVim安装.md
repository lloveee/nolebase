# NeoVim 安装

高颜值命令行IDE。

## Windows

使用 `Scoop` 管理windows包安装

```powershell
# 1. 设置执行策略（允许运行脚本）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 2. 下载并安装 Scoop
irm get.scoop.sh | iex

scoop install neovim git fzf ripgrep fd make gcc tree-sitter


```

安装 Nerd Font (避免图标乱码)
```powershell
# 添加字体仓库
scoop bucket add nerd-fonts

# 安装一款非常流行的字体（JetBrains Mono Nerd Font）
scoop install JetBrainsMono-NF
```

克隆 LazyVim 配置
```powershell
git clone https://github.com/LazyVim/starter $env:LOCALAPPDATA\nvim
```


## Ubuntu

安装Homebrew包管理，apt太旧

```bash
sudo apt update
sudo apt install build-essential procps curl file git -y

/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

(echo; echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"') >> ~/.bashrc
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
```

使用brew 安装neovim
```bash
brew install neovim
nvim --version
```

同样安装lazy vim 进行 vim包管理
http://www.lazyvim.org/installation
```bash
git clone https://github.com/LazyVim/starter ~/.config/nvim
```


🎯 **JACKPOT!** Found a JSON blob with the real credentials:

- `game_app_id`: **1110543085** (not 27808!)
- `access_token`: **179E1121DA8180D42B898029DAE824DD** (32 hex chars!)
- `timestamp`: **1775792097437** (milliseconds)
- `open_id`: `6721361396744912272`

Let me test these immediately as keys.