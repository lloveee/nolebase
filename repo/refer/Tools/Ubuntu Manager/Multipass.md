---
nolebase:
  gitChangelog: false
  pageProperties: false
---
# Multipass

管理多ubuntu实例，进行模拟分布式、网络编程实验

Install https://canonical.com/multipass/install
Document : https://documentation.ubuntu.com/multipass/latest/

- Launch an instance (by default  you get the current Ubuntu LTS):
    
    ```bash
    multipass launch --name foo
    ```
    
- Run commands in that instance, try running bash (logout or ctrl-d to quit):
    
    ```bash
    multipass exec foo -- lsb_release -a
    ```
    
- See your instances:
    
    ```bash
    multipass list
    ```
    
- Stop and start instances:
    
    ```bash
    multipass stop foo bar
    ```
    
    ```bash
    multipass start foo
    ```
    
- Clean up what you don't need:
    
    ```bash
    multipass delete bar
    ```
    
    ```bash
    multipass purge
    ```
    
- Find alternate images to launch:
    
    ```bash
    multipass find
    ```
    
- Pass a cloud-init metadata file to an instance on launch. (See [Using cloud-init with Multipass](https://blog.ubuntu.com/2018/04/02/using-cloud-init-with-multipass) for more details):
    
    ```bash
    multipass launch -n bar --cloud-init cloud-config.yaml
    ```
    
- Get help:
    
    ```bash
    multipass help
    ```
    
    ```bash
    multipass help <command>
    ```

### 示例
```bash
multipass networks  //查看物理网卡

$ Name   Type   Description
$ WLAN   wifi   Intel(R) Wi-Fi 6 AX201 160MHz
```

```bash
multipass launch 25.04 --name u25-node1 --network WLAN
multipass launch 25.04 --name u25-node1 --cpus 1 --memory 2G --disk 10G --network WLAN
//指定镜像版本号，实例名称，网卡
```


### SSH 连接 Multipass Ubuntu实例

默认无初始化账密登录，使用公钥登录

查询已有公钥
```bash
multipass exec u25-node2 -- cat /home/ubuntu/.ssh/authorized_keys
```

写入本机公钥
```bash
//查询本机公钥
type %USERPROFILE%\.ssh\id_ed25519.pub 
//写入公钥
multipass exec u25-node2 -- bash -c "echo '<具体公钥>' >> /home/ubuntu/.ssh/authorized_keys" 

//更新权限
multipass exec u25-node2 -- sudo chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys

multipass exec u25-node2 -- sudo chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Visual Studio Code ssh 配置
```json
Host u25-node2
  HostName 192.168.1.6
  User ubuntu
```