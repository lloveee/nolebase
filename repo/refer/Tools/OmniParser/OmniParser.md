# OmniParser

安装Conda
https://www.anaconda.com/docs/getting-started/miniconda/install/windows-cli-install#how-do-i-verify-my-installers-integrity

```conda
conda create -n "omni" python==3.12

conda activate omni
```

安装torch
```conda
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

克隆仓库，下载模型，模型放至 ./weights
```bash
git clone https://github.com/microsoft/OmniParser.git
cd OmniParser
pip install -r requirements.txt
```

```python
import os
from huggingface_hub import snapshot_download

def download_omni_v2():
    print("🚀 正在检查并下载 OmniParser V2 权重...")
    # 只下载你需要的 V2.0 权重
    snapshot_download(
        repo_id="microsoft/OmniParser-v2.0",
        local_dir="weights",
        allow_patterns=["icon_detect/*", "icon_caption/*"]
    )
    
    # 按照项目要求重命名目录（这是原项目的一个小坑）
    old_path = os.path.join("weights", "icon_caption")
    new_path = os.path.join("weights", "icon_caption_florence")
    if os.path.exists(old_path) and not os.path.exists(new_path):
        os.rename(old_path, new_path)
        print("✅ 权重目录重命名完成")
    
    print("✨ 所有模型已就绪！路径：./weights")

if __name__ == "__main__":
    download_omni_v2()
```

只启动OmniParser项目的server api
```bash
cd omnitool/omniparserserver
python -m omniparserserver
```

跑通后会发现omniparser无法解析中文

找到`./util/utils.py`修改如下代码：
```python
from matplotlib import pyplot as plt
import easyocr
from paddleocr import PaddleOCR
reader = easyocr.Reader(['ch_sim', 'en']) #中英混合
paddle_ocr = PaddleOCR(
    lang='ch',  # 中文OCR模型
    use_angle_cls=False,
    use_gpu=False,  # using cuda will conflict with pytorch in the same process
    show_log=False,
    max_batch_size=1024,
    use_dilation=True,  # improves accuracy
    det_db_score_mode='slow',  # improves accuracy
    rec_batch_num=1024)

```


- 我们搜索的是 `坝` = **0x574d**
- OmniParser 返回的是 `坝` = **0x575d**