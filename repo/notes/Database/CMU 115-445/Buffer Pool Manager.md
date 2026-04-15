---
tags:
  - Database
  - Lab
  - Buffer
---
# Buffer Pool Manager


> [ARC: A SELF-TUNING, LOW OVERHEAD REPLACEMENT CACHE](/archieve/database-cmu/arcfast.pdf) 前排强烈建议深入阅读该论文


## 缓存策略 Cache Replacement Policy

随着硬件技术的发展，机器的标配主存也越来越大了，尽管如此，始终是比不上数据库使用量的增长，因此对于数据库读写的缓存问题，时至今日仍然值得细细探讨。

数据库运行时，我们可以简单的把数据的存储位置划分为两类，内存和硬盘；内存是供机器运行时读写，是易失性的。而硬盘则是为持久化读写，是非易失性的。从硬件的构造，以及造价来讲，两者是各有优劣，内存读写速度快，造价高，硬盘自然读写速度慢了，造价却也低。通常硬盘的容量也远远大于内存。

数据库的最终数据自然是要落在硬盘中的，可日常使用起来，倘若每次数据读写，都与硬盘交互，那效率当然大打折扣。为此实际交互中，总是预先将有限的一批直接或间接相关的数据一同加载在内存中，在后续数据库的交互中，也就不必多次从硬盘读取数据。

然而内存的容量毕竟有限，思考如何妥善管理这部分有限的空间内存储的数据，以便提高数据交互效率，减少硬盘交互次数，就是缓存算法所探讨的内容了。

### LRU / LFU

计算机家族学问探讨的核心总是往往殊途同归。早在计算机硬件缓存设计，以及操作系统虚拟内存设计中就有显现。

最直接简单，却也是精髓之一的策略就是 least recently used，在缓存未命中时，替换缓存，最自然的当然是剔除其中最久未使用的数据块。

最简单能想得到的，总是经不起推敲。倘若缓存的容量与实际使用数据的容量达到一个恰到好处的比例，并且数据块的使用总是与时间很有关系，那么LRU自然可以大展身手。可惜这个比例系数既不好选取，又不会自动调节，乃至对于数据库最简单常见的线性扫描，又称缓存污染，LRU都难以应付。

与此类似的策略是 least frequently used，将时间换成频率，同样是局限于特定的使用情况。

### LRU-K

法如其名，在LRU后带上一个参数K，即是在LRU的基础上纵向扩展K层，以达到抵御污染的效果。其中当K=2时，表现效果尤其好，于是常见论文中引用LRU-2进行讨论。

### 2Q (Two Queue)



### LIRS


### LRFU


### ARC


## ARC 实现

### 准备 & 规则

ARC算法一定程度上可以理解为升级版的LRU-K。
#### 数据

* 数据上维护一个L1(LRU)
* 一个L2(LFU >= 2)
* 从L1中最近淘汰的影子列表B1
* L2中最近淘汰的影子列表B2
* 以及一个哈希表映射内存中实际存储的pages。
* 参数c表示L1，L2内存T1,T2所能容纳最大的pages数量
* 动态参数p，作为分割点，p表示L1中T1的容量，c-p表示L2中T2的容量

```c++
// ArcReplacer
struct FrameStatus {
  page_id_t page_id_;
  frame_id_t frame_id_;
  bool evictable_;
  ArcStatus arc_status_;
  std::list<frame_id_t>::iterator iter_;
  FrameStatus(page_id_t pid, frame_id_t fid, bool ev, ArcStatus st)
      : page_id_(pid), frame_id_(fid), evictable_(ev), arc_status_(st) {}
};
std::list<frame_id_t> mru_;
std::list<frame_id_t> mfu_;
std::list<page_id_t> mru_ghost_;
std::list<page_id_t> mfu_ghost_;
std::unordered_map<frame_id_t, std::shared_ptr<FrameStatus>> alive_map_;
std::unordered_map<page_id_t, std::shared_ptr<FrameStatus>> ghost_map_;

size_t mru_target_size_{0}; // aka p
size_t replacer_size_; // aka c
std::mutex latch_;

std::unordered_map<page_id_t, std::list<page_id_t>::iterator> mru_ghost_map;
std::unordered_map<page_id_t, std::list<page_id_t>::iterator> mfu_ghost_map;
```

#### 规则

对于p的增长步幅，缓存命中B1/B2情况如下：
* 命中B1
	* |B1| >= |B2|，p += 1
	* |B1| < |B2|，p += |B2| / |B1|
* 命中B2
	* |B2| >= |B1|，p -= 1
	* |B2| < |B1|，p -= |B1| / |B2|

直觉上也比较相近，当B1/B2数量较小，仍能命中，说明L1/L2淘汰几乎都是仍然将会再用上的，也就表明L1/L2需要急需更大的空间，当B1/B2数量相对大时，能够命中，说明L1/L2淘汰的虽然还会用上，但是概率小了很多，只需要增加一点点L1/L2的容量即可。

假定存在输入流: `x1, x2, ... , xt, ...` 设 `p = 0`, `T1 = B1 = T2 = B2 = null`, `T1 + B1 = L1`, `T2 + B2 = L2` 缓存总容量为 `c`，系统必定已通过 `Evict()` 保证物理缓存有空位。

对于任意新访问的 `xt`，`RecordAccess` 的分类流转如下：

**Case 1：命中主缓存 (xt 存在于 T1 或 T2)**

- 将 `xt` 从原有位置移除，作为 MRU 移至 `T2` 的头部。
- _(如果原来在 T1，它的身份就正式晋升为 T2)_。

**Case 2/3：命中幽灵列表 (xt 存在于 B1 或 B2)**

- **如果是 B1**：按规则调大目标值 `p`。
- **如果是 B2**：按规则调小目标值 `p`。
- 将 `xt` 从幽灵列表 `B1` 或 `B2` 中彻底移除。
- 将 `xt` 作为全新的物理页，移至 `T2` 的头部（复活并晋升）

**Case 4：彻头彻尾的未命中 (xt 并不存在于上述 4 个列表中)** _此时需要控制系统的总追踪名额，防止爆内存：_

- **情况 A：如果 `L1` (即 T1 + B1) 的长度刚好等于 `c`**
    - _(因为 BusTub 保证了此时 `T1` 不可能满，所以 `B1` 绝对不为空)_。
    - 直接删除 `B1` (MRU 幽灵列表) 尾部最老的数据。
- **情况 B：如果 `L1` 的长度不到 `c`**
    - 说明 `B1` 名额没占满，那么去检查四表总追踪长度：
    - 如果 `L1 + L2` 的总长度已经达到了极限 `2c`，直接删除 `B2` (MFU 幽灵列表) 尾部最老的数据。
- **最终动作**：经过上面的瘦身，放心地将全新的 `xt` 作为 MRU 移入 `T1` 的头部。

```c++
void ArcReplacer::RecordAccess(frame_id_t frame_id, page_id_t page_id, [[maybe_unused]] AccessType access_type) {
    std::lock_guard<std::mutex> lock(latch_);
    // 将列表查询O(n)降至O(1)
    auto it = alive_map_.find(frame_id);
    auto mru_g_it = mru_ghost_map.find(page_id);
    auto mfu_g_it = mfu_ghost_map.find(page_id);

	//命中T1 or T2
    if (it != alive_map_.end()){
		//将目标移动至mfu作为MRU
        if (it->second->arc_status_ == ArcStatus::MRU){
            mfu_.splice(mfu_.begin(), mru_, it->second->iter_);
            it->second->arc_status_ = ArcStatus::MFU;
        } else {
            mfu_.splice(mfu_.begin(), mfu_, it->second->iter_);
        }
        return;
    }
    //命中B1 or B2，调整参数p，目标移动至mfu作为MRU 
    else if (mru_g_it != mru_ghost_map.end() || mfu_g_it != mfu_ghost_map.end()){
        if (mru_g_it != mru_ghost_map.end()){
            if (mru_ghost_.size() >= mfu_ghost_.size()){
                mru_target_size_++;
                if (mru_target_size_ > replacer_size_) mru_target_size_ = replacer_size_;
            } else {
                mru_target_size_ += mfu_ghost_.size() / mru_ghost_.size();
                if (mru_target_size_ > replacer_size_) mru_target_size_ = replacer_size_;
            }
            mru_ghost_.erase(mru_g_it->second);
            mfu_.push_front(frame_id);
            alive_map_[frame_id] = std::make_shared<FrameStatus>(page_id, frame_id, false, ArcStatus::MFU);
            alive_map_[frame_id]->iter_ = mfu_.begin();
            mru_ghost_map.erase(mru_g_it);
            return;
        } else {
            size_t delta = (mfu_ghost_.size() >= mru_ghost_.size()) ? 1 : (mru_ghost_.size() / mfu_ghost_.size());
            if (mru_target_size_ < delta) {
                mru_target_size_ = 0;
            } else {
                mru_target_size_ -= delta;
            }
            mfu_ghost_.erase(mfu_g_it->second);
            mfu_.push_front(frame_id);
            alive_map_[frame_id] = std::make_shared<FrameStatus>(page_id, frame_id, false, ArcStatus::MFU);
            alive_map_[frame_id]->iter_ = mfu_.begin();
            mfu_ghost_map.erase(mfu_g_it);
            return;
        }
    }
    //未命中缓存，按需清理B1/B2缓存，将新目标移动至T1作为MRU 
    else {
        if (mru_.size() + mru_ghost_.size() == replacer_size_){
            mru_ghost_map.erase(mru_ghost_.back());
            mru_ghost_.pop_back();
        } else if (mru_.size() + mru_ghost_.size() + mfu_.size() + mfu_ghost_.size() >= 2 * replacer_size_){
            mfu_ghost_map.erase(mfu_ghost_.back());
            mfu_ghost_.pop_back();
        }
        mru_.push_front(frame_id);
        alive_map_[frame_id] = std::make_shared<FrameStatus>(page_id, frame_id, false, ArcStatus::MRU);
        alive_map_[frame_id]->iter_ = mru_.begin();
    }
}

```

对于驱逐函数而言，相对简单很多，若T1 >= p，理应先驱逐T1末尾，否则驱逐T2末尾，反之亦然，当然对于项目中，存在`pinned`操作标记`frame`不可驱逐，所以当条件成立，T1/T2，均不可驱逐，退而对T2/T1操作，再不然返回null

```c++
auto ArcReplacer::Evict() -> std::optional<frame_id_t> {
	std::lock_guard<std::mutex> lock(latch_);
	
	if (mru_.size() >= mru_target_size_){
        if (auto v = TryEvict(mru_, mru_ghost_, mru_ghost_map)) return v;
        return TryEvict(mfu_, mfu_ghost_,mfu_ghost_map);
    } else {
        if (auto v = TryEvict(mfu_, mfu_ghost_, mfu_ghost_map)) return v;
        return TryEvict(mru_, mru_ghost_, mru_ghost_map);
    }
}

std::optional<frame_id_t> ArcReplacer::TryEvict(std::list<frame_id_t> &list, std::list<page_id_t> &ghost_list, std::unordered_map<page_id_t, std::list<page_id_t>::iterator> &ghost_map){
    for (auto it = list.rbegin(); it != list.rend(); it++){
        auto map_it = alive_map_.find(*it);
        if (map_it != alive_map_.end() && map_it->second->evictable_){
            frame_id_t fid = map_it->second->frame_id_;
            page_id_t pid = map_it->second->page_id_;
            list.erase(std::next(it).base());
            ghost_list.push_front(pid);
            ghost_map[pid] = ghost_list.begin();
            alive_map_.erase(fid);
            curr_size_--;
            return fid;
        }
    }
    return std::nullopt;
}
```


## 磁盘调度器 Disk Scheduler

### C++ 实现简单的channel
```c++
void Put(T element){
	std::unique_lock<std::mutex> lk(m_);
	q_.push(std::move(element));
	lk.unlock();
	cv_.notify_all();
}

auto Get() -> T {
	std::unique_lock<std::mutex> lk(m_);
	//阻塞直到存在数据进行消费
	cv_.wait(lk, [&]() {return !q_.empty(); })
	T element = std::move(q_.front());
	q_.pop();
	return element;
}

private:
	std::mutex m_;
	std::condition_variable cv_;
	std::queue<T> q_;
```

对于每一个磁盘请求，存在如下结构封装
```c++
struct DiskRequest{
	bool is_write_;
	char *data_;
	page_id_t page_id_;
	std::promise<bool> callback_;
}
```

为了解耦请求与执行，并且保证线程安全，这里使用promise + future的组合。比较形象的形容是`promise`是构造的订单，而`future`则是订单对应的取餐码，主线程创建订单`p`，并将其`move`进子线程后，通过在子线程中对`promise`调用`.set_value()`进行通知。而主线程可通过`future.get()`进行状态查询，整个过程线程安全。具体实例如下：
```c++
auto promise = disk_scheduler->CreatePromise();
auto future = promise.get_future();
DiskRequest r1{ture, data, page_id, std::move(promise)}
disk_scheduler->Schedule(r1); // 消费request并设置promise为ture
ASSERT_TURE(future.get());
```

磁盘调度器内部维护一个请求队列，以及一个实际执行请求的工作线程。并持有实际disk_manager的引用。
```c++
private:
	DiskManager *dis_manager_ ;
	Channel<std::optional<DiskRequest>> request_queue_;
	std::optional<std::thread> background_thread_;
```

调度器创建之初，启动工作线程，并死等查询请求队列并执行请求，直到调度器销毁。
```c++
DiskScheduler::DiskScheduler(DiskManager *disk_manager) : disk_manager_(disk_manager) {
  background_thread_.emplace([&] { StartWorkerThread(); });
}

DiskScheduler::~DiskScheduler(){
	//加入空请求进行中止死等
	request_queue_.Put(std::nullopt);
	//等待工作线程完成收尾
	if (background_thread_.has_value()){
		background_thread_->join();
	}
}

void DiskScheduler::StartWorkerThread(){
	while (auto r = request_queue_.Get()){
		if (!r->is_write_) disk_manager_->ReadPage(r->page_id_, r->data_);
		else disk_manager_->WritePage(r->page_id_, r->data_);
		r->callback_.set_value(true);
	}
}
```

外部封装好的请求通过Schedule函数向调度器队列添加请求
```c++
void DiskScheduler::Schedule(std::vector<DiskRequest> requests){
	for(auto &r : requests){
		request_queue_.Put(std::move(r));
	}
	requests.clear();
}
```


## BufferPool Manager

BPM的职责简单来讲，就是让数据库上层在实际使用中，能感到仿佛拥有无限大的内存。

这里的两个名词必须先搞清楚，`page`和`frame`

为了方便数据存储以及追踪，数据库将最小数据单位称作`page`，通常是一个8kb大小的数据块，最终归档入硬盘。

`frame`本质上是在数据库启动后，在内存中申请分配好的一连串`page`槽位，从硬盘中读上来的`page`就放在`frame`中

更直观的了解frame可以参考如下结构
```c++
class FrameHeader {
private:
	auto GetData() const -> const char *;
	auto GetDataMut() -> char *;
	void Reset();
	const frame_id_t frame_id_;
	std::shared_mutex rwlatch_;
	std::atomic<size_t> pin_count_;
	bool is_dirty_;
	std::vector<char> data_;
}
```

换句话说，`frame`中实际存储的是`page`的副本，因此在实际考虑中，`frame`中存储的`page`是必须考虑并发问题的。

为了更好的管理和使用内存中的`page`副本，更现代化的c++模式是引出新的类利用RAII和生命周期管理。

RAII全称 Resource Acquistion Is Initialization，Resource在这里指的是诸如内存、文件句柄、锁一类，在使用时通常包括请求资源、使用、以及销毁或者归还资源。RAII所述Acquistion Is Initialization，表意为资源管理的最佳实践应该是绑定到栈对象的生命周期。也就是在对象调用构造函数时进行请求，在析构函数中自动释放。

### PageGuard

职责
* 持有实际`page`副本，以及所在`frame`槽位
* 持有`page`交互磁盘调度器刷盘的实际权力

为了保证PageGuard的权威性，也是更好的遵循RAII实践，这里引入`rust`语言中所有权的概念，PageGuard在这里意味持有`page`实际所有权的对象。不可复制、单独存在。
```c++
ReadPageGuard() = default;
//禁用左值拷贝和拷贝构造函数
ReadPageGuard(const ReadPageGuard &) = delete;
auto operator=(const ReadPageGuard &) -> ReadPageGuard & = delete;
//实现右值拷贝和移动构造函数
ReadPageGuard(ReadPageGuard &&that) noexcept;
auto operator=(ReadPageGuard &&that) noexcept -> ReadPageGuard &;
```

右值拷贝和移动构造函数的实现，充分体现了`rust`中所有权转移的编程哲学
```c++
ReadPageGuard::ReadPageGuard(ReadPageGuard &&that) noexcept {
  if (this == &that) {
    return;
  }
  this->page_id_ = that.page_id_;
  this->frame_ = std::move(that.frame_);
  this->replacer_ = std::move(that.replacer_);
  this->bpm_latch_ = std::move(that.bpm_latch_);
  this->disk_scheduler_ = std::move(that.disk_scheduler_);
  this->is_valid_ = that.is_valid_;
  that.is_valid_ = false;
}

auto ReadPageGuard::operator=(ReadPageGuard &&that) noexcept -> ReadPageGuard &{
  if (this == &that) {
    return *this;
  }
  //先释放自己原本的资源
  Drop();
  this->page_id_ = that.page_id_;
  this->frame_ = std::move(that.frame_);
  this->replacer_ = std::move(that.replacer_);
  this->bpm_latch_ = std::move(that.bpm_latch_);
  this->disk_scheduler_ = std::move(that.disk_scheduler_);
  this->is_valid_ = that.is_valid_;
  that.is_valid_ = false;
  return *this
}
```

刷盘操作
```c++
void WritePageGuard::Flush() {
  if (frame_->is_dirty_) {
    std::promise<bool> promise;
    auto future = promise.get_future();
    std::vector<DiskRequest> r;
    r.push_back(DiskRequest{true, frame_->GetDataMut(), page_id_, std::move(promise)});
    disk_scheduler_->Schedule(r);
    future.get();
    frame_->is_dirty_ = false;
  }
}
```

RAII
构造移动成员的同时，标记is_valid防止多次Drop
```c++
WritePageGuard::WritePageGuard(page_id_t page_id, std::shared_ptr<FrameHeader> frame,
                               std::shared_ptr<ArcReplacer> replacer, std::shared_ptr<std::mutex> bpm_latch,
                               std::shared_ptr<DiskScheduler> disk_scheduler)
    : page_id_(page_id),
      frame_(std::move(frame)),
      replacer_(std::move(replacer)),
      bpm_latch_(std::move(bpm_latch)),
      disk_scheduler_(std::move(disk_scheduler)) {
  is_valid_ = true;
}

void WritePageGuard::Drop() {
  if (!is_valid_) return;
  frame_->is_dirty_ = true;
  frame_->rwlatch_.unlock();
  bpm_latch_->lock();
  frame_->pin_count_--;
  if (frame_->pin_count_ == 0) {
    replacer_->SetEvictable(frame_->frame_id_, true);
  }
  bpm_latch_->unlock();
  is_valid_ = false;
}

void ReadPageGuard::Drop() {
  if (!is_valid_) return;
  //std::shared_ptr<std::mutex> unlock_shared表示解开只读锁 unlock表示解开读写锁
  frame_->rwlatch_.unlock_shared();
  bpm_latch_->lock();
  frame_->pin_count_--;
  if (frame_->pin_count_ == 0) {
    replacer_->SetEvictable(frame_->frame_id_, true);
  }
  bpm_latch_->unlock();
  is_valid_ = false;
}

//析构自动Drop
WritePageGuard::~WritePageGuard() { Drop(); }
```

### BPM

有了封装好的`PageGuard`，接下来我们管理`Page`的任务就轻松多了。

回顾一下此前构造的两大利器，`ArcReplacer`、`DiskScheduler`

### CheckedWritePage / CheckedReadPage 核心逻辑

两者的核心逻辑完全对称，区别在于锁的粒度和写标志：

```cpp
// CheckedWritePage：独占写锁
frame->rwlatch_.lock();   // 独占锁
frame->is_dirty_ = true;  // 写操作 → 脏页标记

// CheckedReadPage：共享读锁
frame->rwlatch_.lock_shared();  // 共享锁
```

整体流程三分支（以 CheckedWritePage 为例）：

**① 缓存命中（page 已存在于 page_table_）**

```cpp
if (page_table_.find(page_id) != page_table_.end()) {
  frame = frames_[page_table_[page_id]];
  frame->pin_count_++;
  replacer_->SetEvictable(frame->frame_id_, false);  // 正在使用，不可驱逐
  replacer_->RecordAccess(frame->frame_id_, page_id, access_type);
}
```

**② free_frames 有可用 frame（free list 非空）**

> ⚠️ 关键：`if (!free_frames_.empty())` 而不是 `if (!frames_.empty())`
> `frames_` 预分配后永远不为空，用 `frames_` 判断会导致对空 free list 调用 `back()` + `pop_back()` —— UB，ASAN 崩溃。

```cpp
if (!free_frames_.empty()) {
  frame = frames_[free_frames_.back()];
  free_frames_.pop_back();
  if (frame->is_dirty_) {
    // 旧数据可能是脏页，先写回磁盘（同步等待）
    std::promise<bool> p;
    auto f = p.get_future();
    disk_scheduler_->Schedule({true, frame->GetDataMut(), frame->page_id_, std::move(p)});
    f.get();
  }
  frame->Reset();
  frame->pin_count_++;
  frame->page_id_ = page_id;
  page_table_[page_id] = frame->frame_id_;
  // ⚠️ 必须从磁盘读取新 page 数据！
  std::promise<bool> p;
  auto f = p.get_future();
  disk_scheduler_->Schedule({false, frame->GetDataMut(), page_id, std::move(p)});
  f.get();
  replacer_->RecordAccess(frame->frame_id_, page_id, access_type);
  replacer_->SetEvictable(frame->frame_id_, false);
}
```

**③ 需要 eviction（free list 空，必须驱逐一个 frame）**

```cpp
if (auto frame_id = replacer_->Evict()) {
  frame = frames_[frame_id.value()];
  if (frame->is_dirty_) {
    // 写回磁盘到它原本的 page_id（同步等待）
    std::promise<bool> p;
    auto f = p.get_future();
    disk_scheduler_->Schedule({true, frame->GetDataMut(), frame->page_id_, std::move(p)});
    f.get();
  }
  page_table_.erase(frame->page_id_);  // 擦除旧映射
  frame->Reset();                        // 清空 frame 数据
  frame->pin_count_++;
  frame->page_id_ = page_id;
  page_table_[page_id] = frame->frame_id_;
  // ⚠️ 必须从磁盘读取新 page 数据！
  std::promise<bool> p;
  auto f = p.get_future();
  disk_scheduler_->Schedule({false, frame->GetDataMut(), page_id, std::move(p)});
  f.get();
  replacer_->RecordAccess(frame->frame_id_, page_id, access_type);
  replacer_->SetEvictable(frame->frame_id_, false);
}
```

**最后统一加锁，返回 guard（在 bpm_latch_ 之外执行）：**

```cpp
frame->rwlatch_.lock();  // 或 lock_shared()
return WritePageGuard(page_id, std::move(frame), replacer_, bpm_latch_, disk_scheduler_);
```

> ⚠️ 锁的顺序：先释放 bpm_latch_，再加 frame 的 rwlatch_。否则会造成死锁（持大锁等小锁）。

### 今日 Debug 关键教训

1. **`!frames_.empty()` vs `!free_frames_.empty()`**：前者永远为真（frames_ 预分配后永不空），后者才是正确的判断条件。这个笔误会导致对空 list 调用 `back()` + `pop_back()`，是 UB，ASAN 会报 `alloc-dealloc-mismatch`。

2. **eviction 路径必须调度磁盘读**：`frame->Reset()` 把数据填 0 后，必须调度 `DiskRequest{false, ...}` 从磁盘把新 page 的实际数据读进来，否则用户拿到的是全 0 数据。

3. **`SetEvictable` 的调用时机**：pin_count 从 0 变 1 时 → 不可驱逐（`false`）；从 1 变 0 时 → 可驱逐（`true`）。在 CheckedReadPage/CheckedWritePage 里 pin_count++ 后立即设 `false`，在 PageGuard::Drop() 里 pin_count-- 后判断是否为 0 再设 `true`。

4. **`RecordAccess` 的调用时机**：每次往 frame 里装入新 page（无论是 free frame 路径还是 eviction 路径）都要调用，让 ArcReplacer 重新认识这个 frame。漏了会导致 ArcReplacer 的 alive_map_ 丢失 frame，Evict() 选到正在被 pin 的 frame → use-after-free。

5. **`promise.get()` 的必要性**：`DiskScheduler::Schedule` 把请求入队后立即返回，不等执行完成。对于需要同步等待的场景（eviction 前写回、加载新 page 后才能访问），必须用 `promise/future` 手动等待。`FlushAllPages` 则是批量等待所有 future。

6. **`Drop()` 的顺序不能错**：先 unlock rwlatch_（否则其他线程无法访问），再 lock bpm_latch_（访问 page_table_ 和 pin_count 需要），最后 unlock bpm_latch_。顺序反了会死锁。

### NewPage 细节（2026-04-15）

`NewPage()` 分配新 page 后，必须将新 frame 向 ArcReplacer 注册：

```cpp
page_table_[np_id] = frame_id;
replacer_->RecordAccess(frame_id, np_id);   // 让 replacer 认识这个 frame
replacer_->SetEvictable(frame_id, true);    // 新 page 可驱逐
return np_id;
```

### DeletePage 完整实现（2026-04-15 重写）

旧版直接返回 `true`（stub），新版完整实现：

```cpp
auto BufferPoolManager::DeletePage(page_id_t page_id) -> bool {
  std::scoped_lock latch(*bpm_latch_);
  if (page_table_.find(page_id) == page_table_.end()) {
    return true;  // 不存在 → 算删除成功
  }
  auto frame = frames_[page_table_[page_id]];
  if (frame->pin_count_ > 0) {
    return false;  // 还在被 pin，不能删
  }
  disk_scheduler_->DeallocatePage(page_id);      // 通知磁盘层释放 page
  replacer_->Remove(frame->frame_id_);           // 从 replacer 移除
  frame->Reset();                                 // 重置 frame 内容
  page_table_.erase(page_id);                    // 移除映射
  free_frames_.push_back(frame->frame_id_);       // 归还 free list
  return true;
}
```

### FlushAllPages 并行刷盘（2026-04-15）

```cpp
void BufferPoolManager::FlushAllPages() {
  std::scoped_lock latch(*bpm_latch_);
  std::vector<std::future<bool>> futures;
  for (auto &frame : frames_) {
    if (frame->is_dirty_) {
      std::promise<bool> p;
      futures.push_back(p.get_future());
      disk_scheduler_->Schedule({true, frame->GetDataMut(), frame->page_id_, std::move(p)});
      frame->is_dirty_ = false;
    }
  }
  for (auto &f : futures) {
    f.get();  // 等待所有脏页写盘完成
  }
}
```

`FlushAllPagesUnsafe` 逻辑相同但不加 bpm_latch_，适用于启动阶段批量刷盘。

实现简单，O(1) 查询：

```cpp
auto BufferPoolManager::GetPinCount(page_id_t page_id) -> std::optional<size_t> {
  std::scoped_lock latch(*bpm_latch_);
  auto it = page_table_.find(page_id);
  if (it == page_table_.end()) {
    return std::nullopt;
  }
  return frames_[it->second]->pin_count_.load();
}
```

遍历 page_table_（hash table）直接定位 frame，返回其原子计数。
