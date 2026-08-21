# Magic Game Harness — Primitives 深度解读

> 源码位置：`Assets/GameFramework/Core/Primitives/`
> 4 个文件 + 1 个诊断子目录，共 ~580 行
> **这是整个框架最底层的"原子层"**——一旦定下来就很难改，所以作者写得非常保守。

---

## 0. 为什么 Primitives 这么重要？

Primitives 是 **AOT 内核 + HybridCLR 热更层**共享的"语法层"。它必须满足：

| 要求 | 失败后果 |
|---|---|
| **跨进程稳定**（hash、ID 序列化） | 两台机器握手时把同一个模块识别成不同模块 |
| **跨文化稳定**（大小写、字符集） | 一台机器日本玩家能加载的 Mod，另一台美国玩家加载失败 |
| **跨版本可比**（版本号比较） | `1.0.0-beta.2` vs `1.0.0-beta.11` 必须按 SemVer spec 正确排序 |
| **默认值无效**（防 null 滥用） | `default(ModuleId)` 必须不能被当作合法 ID 用 |

**这些约束决定了实现选型**：FNV-1a 而不是 `string.GetHashCode`、StringComparison.Ordinal 而不是 `CurrentCulture`、readonly struct + 私有构造而不是 class。

---

## 1. NamespacedIdentifier — 验证式值对象

**文件**：`NamespacedIdentifiers.cs`

### 1.1 模式总览：readonly struct + 私有构造 + Parse

```csharp
public readonly struct ModuleId : IEquatable<ModuleId>
{
    readonly string value;
    ModuleId(string value) => this.value = value;  // ← 私有构造！
    public bool IsValid => !string.IsNullOrEmpty(value);
    public static ModuleId Parse(string value) { ... }
    public static bool TryParse(string value, out ModuleId result) { ... }
}
```

**三个关键设计点**：

#### (a) 私有构造函数

```csharp
ModuleId(string value) => this.value = value;  // 没 public 修饰符
```

**结果**：外部代码**只能**通过 `Parse` / `TryParse` 构造 `ModuleId`。编译器不会报错地拒绝 `new ModuleId("bad-format")`——这强制所有构造都走验证。

#### (b) 默认值天然无效

```csharp
public bool IsValid => !string.IsNullOrEmpty(value);
```

`default(ModuleId)` 在 C# 里会把所有字段置零/默认值——也就是 `value = null`。所以 `IsValid == false`。
**测试断言了这一点**：`NamespacedIdentifierTests.Namespaced_identifier_defaults_are_invalid`

#### (c) Parse + TryParse 双路径

```csharp
public static ModuleId Parse(string value)
{
    if (!TryParse(value, out var result))
        throw NamespacedIdentifier.FormatException(nameof(ModuleId), value);
    return result;
}

public static bool TryParse(string value, out ModuleId result)
{
    if (!NamespacedIdentifier.IsValid(value))
    {
        result = default;
        return false;
    }
    result = new ModuleId(value);
    return true;
}
```

**这是 .NET 标准模式**——`int.TryParse` / `DateTime.TryParse` 都这么写。`Parse` 用于"必须成功"的场景，`TryParse` 用于"可能失败且需要降级"的场景。

### 1.2 验证规则的严格性

| 规则 | 测试用例 | 为什么 |
|---|---|---|
| 必含 `.` | `single` ❌ | 强制多段命名空间，避免"全局 ID 冲突" |
| 总长 ≤ 128 | （隐式） | 防恶意/拼写错 |
| 每段以小写字母开头 | `Author.module` ❌, `1author.module` ❌ | 跨文化稳定 + 强制人写 |
| 段内：a-z + 0-9 + `-` | `framework.capability/value` ❌, `author.module_` ❌ | 字符串解析安全 |
| 不允许连续 `.` / 不以 `.` 结尾 | `author..module` ❌, `author.module.` ❌ | 解析歧义 |

**详细正则逻辑**（`NamespacedIdentifier.IsValid`）：

```csharp
var segmentStart = true;
for (var index = 0; index < value.Length; index++)
{
    var character = value[index];
    if (character == '.')
    {
        if (segmentStart || index == value.Length - 1)
            return false;       // ① 段开头是 '.'  或 ② 以 '.' 结尾
        segmentStart = true;
        continue;
    }

    if (segmentStart)
    {
        if (character < 'a' || character > 'z')
            return false;       // ③ 段首字符不是小写字母
        segmentStart = false;
        continue;
    }

    var lowercase = character >= 'a' && character <= 'z';
    var digit = character >= '0' && character <= '9';
    if (!lowercase && !digit && character != '-')
        return false;           // ④ 段内出现非法字符
}

return !segmentStart;          // ⑤ 不能以 '.' 结尾（确保 segmentStart 是 false）
```

**5 个退出条件**全部明确列举，**没有正则、没有 CultureInfo**，全是 char 比较——**最快的验证方式**。

### 1.3 强大小写敏感

```csharp
public bool Equals(ModuleId other) => string.Equals(value, other.value, StringComparison.Ordinal);
```

**用 `Ordinal` 而不是 `CurrentCulture` 或 `OrdinalIgnoreCase`**：
- `Ordinal` = 字节级比较，最快
- `OrdinalIgnoreCase` 会让 `Author.module` 和 `author.module` 相等——**会污染命名空间**
- `CurrentCulture` 在不同 locale 机器上行为不一致——**会引发跨进程分歧**

### 1.4 FNV-1a Hash — 跨进程稳定

```csharp
public override int GetHashCode() => StableStringHash.Compute(value);
```

```csharp
static class StableStringHash
{
    public static int Compute(string value)
    {
        unchecked
        {
            var hash = (int)2166136261;          // FNV offset basis（32-bit）
            if (value == null) return hash;
            for (var index = 0; index < value.Length; index++)
                hash = (hash ^ value[index]) * 16777619;   // FNV prime
            return hash;
        }
    }

    public static int Combine(int first, int second)
    {
        unchecked
        {
            return (first * 397) ^ second;
        }
    }
}
```

**为什么不用 `string.GetHashCode()`？**

> ⚠️ .NET runtime 在 **每个进程**里**随机化**字符串的 hash seed（从 .NET Core 2.1 起）。

也就是说：
- 进程 A：`"framework.capability-1".GetHashCode() == 123456`
- 进程 B：`"framework.capability-1".GetHashCode() == -987654`

如果网络协议里用 `GetHashCode()` 做 sharding 或路由，**同一个 key 会被分发到不同节点**。

**FNV-1a 是确定性算法**——输入相同，输出永远相同，**不依赖任何运行时状态**。缺点是 hash 质量不如 xxHash/SipHash，但**对兼容性需求来说足够了**。

### 1.5 ModuleId 与 CapabilityKey 是同一模式的两个实例

```csharp
public readonly struct ModuleId : IEquatable<ModuleId> { /* ... */ }
public readonly struct CapabilityKey : IEquatable<CapabilityKey> { /* ... */ }
```

**两者代码几乎一模一样**——这是有意的。它们代表**两类命名空间 ID**：

| 类型 | 例子 | 用在哪 |
|---|---|---|
| `ModuleId` | `author.module-alpha` | 标识"哪个模块" |
| `CapabilityKey` | `framework.capability-1` | 标识"模块提供了什么能力" |

**为什么分成两个类型而不是一个 `NamespacedId`？**
- **类型安全**：你不能在 `Dictionary<CapabilityKey, ModuleId>` 里填错
- **意图明确**：方法签名 `Register(ModuleId id, CapabilityKey capability)` 一看就懂
- **将来扩展**：CapabilityKey 可能加额外验证规则（比如必须以 `framework.` 开头）

### 1.6 这个模式可以借鉴的场景

| 场景 | 实现 |
|---|---|
| 用户 ID、订单 ID | ✅ 适合 |
| URL slug、API endpoint | ✅ 适合 |
| 配置项 key | ✅ 适合 |
| 内部临时 key（如 `Dict<int, T>`） | ❌ 不需要（用 int） |

---

## 2. SemanticVersion — 教科书级的 SemVer 2.0.0

**文件**：`SemanticVersion.cs`

### 2.1 文档即契约

文件顶部有一段**被 spec 明确引用**的 doc comment：

```csharp
/// <summary>
/// A SemVer 2.0.0 value with an explicit separation between exact identity and SemVer precedence.
/// <see cref="Equals(SemanticVersion)"/> is exact identity and includes build metadata.
/// <see cref="ComparePrecedenceTo"/> and <see cref="PrecedenceComparer"/> implement SemVer
/// precedence, which ignores build metadata. <see cref="CompareTo"/> is a deterministic total
/// order consistent with <see cref="Equals(SemanticVersion)"/>: precedence first, then build
/// metadata as a final ordinal tie-breaker, so sorted collections never collapse unequal values.
/// Dependency and package resolution must use <see cref="PrecedenceComparer"/>.
/// </summary>
```

**这段话回答了一个 SemVer 用户常问的问题**：

> `1.0.0+build.one` 和 `1.0.0+build.two` 应该相等吗？

答案是 **看场景**：

| 场景 | 用 | 原因 |
|---|---|---|
| 依赖解析（"我能升级到这个版本吗？"） | `PrecedenceComparer` | SemVer spec：build metadata 不参与 precedence |
| 存档标识（"这是哪个版本的世界？"） | `Equals` | 两个不同 build 的游戏世界应该被识别为不同 |
| SortedSet 默认排序 | `CompareTo`（默认 `IComparable<T>`） | 总序，避免坍缩 |

### 2.2 三种比较方法的实现

```csharp
public int ComparePrecedenceTo(SemanticVersion other)
{
    if (!IsValid || !other.IsValid)
        throw new InvalidOperationException("Cannot compare an invalid default SemanticVersion.");

    var comparison = Major.CompareTo(other.Major);
    if (comparison != 0) return comparison;
    comparison = Minor.CompareTo(other.Minor);
    if (comparison != 0) return comparison;
    comparison = Patch.CompareTo(other.Patch);
    if (comparison != 0) return comparison;
    return ComparePreRelease(PreRelease, other.PreRelease);   // ← 关键：忽略 build metadata
}

public int CompareTo(SemanticVersion other)
{
    var comparison = ComparePrecedenceTo(other);
    return comparison != 0 ? comparison : string.CompareOrdinal(BuildMetadata, other.BuildMetadata);
}

public bool Equals(SemanticVersion other) =>
    initialized == other.initialized &&
    Major == other.Major &&
    Minor == other.Minor &&
    Patch == other.Patch &&
    string.Equals(PreRelease, other.PreRelease, StringComparison.Ordinal) &&
    string.Equals(BuildMetadata, other.BuildMetadata, StringComparison.Ordinal);
```

**ComparePreRelease** 是 SemVer 2.0.0 spec 第 11 节的实现：

```csharp
static int ComparePreRelease(string left, string right)
{
    // ① 没 prerelease 的版本 > 有 prerelease 的版本
    //    1.0.0-alpha < 1.0.0
    var leftEmpty = string.IsNullOrEmpty(left);
    var rightEmpty = string.IsNullOrEmpty(right);
    if (leftEmpty && rightEmpty) return 0;
    if (leftEmpty) return 1;
    if (rightEmpty) return -1;

    var leftParts = left.Split('.');
    var rightParts = right.Split('.');
    var count = Math.Min(leftParts.Length, rightParts.Length);
    for (var index = 0; index < count; index++)
    {
        var leftNumeric = IsNumericIdentifier(leftParts[index]);
        var rightNumeric = IsNumericIdentifier(rightParts[index]);
        int comparison;
        if (leftNumeric && rightNumeric)
            comparison = CompareNumericIdentifiers(leftParts[index], rightParts[index]);
        else if (leftNumeric)
            comparison = -1;                  // ② 数字 identifier < 字母 identifier
        else if (rightNumeric)
            comparison = 1;
        else
            comparison = string.CompareOrdinal(leftParts[index], rightParts[index]);
        if (comparison != 0) return comparison;
    }
    return leftParts.Length.CompareTo(rightParts.Length);   // ③ 段多的大
}
```

**测试断言了完整的优先级链**：

```csharp
var ordered = new[]
{
    "1.0.0-alpha",      "1.0.0-alpha.1",     "1.0.0-alpha.beta",
    "1.0.0-beta",       "1.0.0-beta.2",      "1.0.0-beta.11",   // ← 11 > 2 正确
    "1.0.0-rc.1",       "1.0.0",
};
```

### 2.3 数字 Prerelease 的"无溢出"实现

```csharp
static int CompareNumericIdentifiers(string left, string right)
{
    if (left.Length != right.Length) return left.Length.CompareTo(right.Length);  // ← 关键
    return string.CompareOrdinal(left, right);
}
```

**为什么按长度比较而不转 long？**

测试里明确写了**超过 `long.MaxValue` 的场景**：

```csharp
// Beyond Int64.MaxValue (9223372036854775807).
Assert.That(
    SemanticVersion.Parse("1.0.0-9223372036854775808"),    // ← 比 long.MaxValue 大 1
    Is.GreaterThan(SemanticVersion.Parse("1.0.0-9223372036854775807")));

// Far beyond any fixed-width integer.
Assert.That(
    SemanticVersion.Parse("1.0.0-100000000000000000000000000000000"),
    Is.GreaterThan(SemanticVersion.Parse("1.0.0-99999999999999999999999999999999")));
```

**实现技巧**：因为 `ValidateIdentifiers` 拒绝了 leading-zero 数字，所以**长度就是数量级**——10 位数一定 > 9 位数，无论具体数字。等长才需要逐字符比较。

**详细注释**：

> Compares two all-digit identifiers of arbitrary length without numeric conversion, so no overflow is possible for values beyond Int32 or Int64. Leading zeroes are rejected during construction and parsing, so digit count alone orders magnitude; equal lengths fall back to an ordinal digit comparison.

### 2.4 Leading-zero 拒绝

```csharp
static bool IdentifiersAreValid(string value, bool rejectLeadingZeroNumeric)
{
    if (string.IsNullOrEmpty(value)) return true;
    var parts = value.Split('.');
    foreach (var part in parts)
    {
        if (part.Length == 0) return false;
        var numeric = true;
        foreach (var character in part)
        {
            var letter = /* A-Z or a-z */;
            var digit = /* 0-9 */;
            if (!letter && !digit && character != '-') return false;
            if (!digit) numeric = false;
        }
        if (rejectLeadingZeroNumeric && numeric && part.Length > 1 && part[0] == '0')
            return false;  // ← 01 不允许
    }
    return true;
}
```

**为什么 prerelease 不允许 leading-zero**？

因为 `1.0.0-1` 和 `1.0.0-01` 在数值上相等，但字符串不等。**SemVer spec 要求这两者被视为相同数值**，所以必须拒绝后者——否则排序会反直觉。

### 2.5 整数组件溢出检测

```csharp
[TestCase("2147483648.0.0")]      // Int32.MaxValue + 1
[TestCase("1.2147483648.0")]
[TestCase("1.0.2147483648")]
[TestCase("99999999999999999999.0.0")]
public void Overflowing_version_components_fail_deterministically(string value)
{
    Assert.That(SemanticVersion.TryParse(value, out _), Is.False);
    Assert.That(() => SemanticVersion.Parse(value), Throws.TypeOf<FormatException>());
}
```

**实现里**：

```csharp
new Regex(
    @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-...)?(?:+...)?$",
    RegexOptions.CultureInvariant);
```

`[1-9][0-9]*` 强制**首位不能为 0 且无长度上限**（regex 默认是 .NET 长字符串，没限制）。`int.TryParse` 内部如果溢出就失败，所以 `2147483648` 会被 reject。

### 2.6 这个实现可以学到什么？

**对比 .NET BCL**：`System.Version` 是 .NET 自带的版本类型，但它**不**遵守 SemVer：
- 不支持 `1.0.0-alpha`
- 不支持 `1.0.0+build`
- 不区分 precedence 和 identity

**如果你的项目需要 SemVer**，强烈建议直接用 `SemanticVersion` 或者参考这个实现，而不是 `System.Version`。

---

## 3. CompatibilityIdentifiers — 四个"兼容性轴"

**文件**：`CompatibilityIdentifiers.cs`

### 3.1 把"兼容性"拆成 4 个独立维度

```csharp
public readonly struct FrameworkCompatibility : IEquatable<FrameworkCompatibility>
{
    public FrameworkCompatibility(
        GameBuildId gameBuild,
        ModApiVersion modApi,
        NetworkProtocolVersion networkProtocol,
        ContentCompatibilityVersion content)
    { /* 验证每个字段 */ }

    public GameBuildId GameBuild { get; }
    public ModApiVersion ModApi { get; }
    public NetworkProtocolVersion NetworkProtocol { get; }
    public ContentCompatibilityVersion Content { get; }
}
```

**为什么拆 4 个？**

考虑场景：游戏的 **Mod API 接口**升级了（`0.1.0` → `0.2.0`），但 **网络协议** 没变。旧 Mod 是否兼容？
- **如果只用一个 `GameVersion` 字段**：旧 Mod 看到 `gameVersion > mine` 就拒绝加载——但其实网络层是兼容的
- **拆成 4 个**：旧 Mod 只看 `ModApi`——发现 `0.1.0 < 0.2.0`，按自己的兼容策略决定

**这就是 spec 第 3.1 节"explicit compatibility"原则的体现**：

> Versions, dependencies, capabilities, network schemas, and save schemas are machine-readable.

### 3.2 各 ID 类型的验证规则

| 类型 | 例子 | 验证 |
|---|---|---|
| `GameBuildId` | `framework.phase1_dev-1` | 字母+数字+`.`+`-`+`_`，≤128 |
| `ModApiVersion` | `0.1.0` / `2.0.0-preview.1` | 完整 SemVer |
| `NetworkProtocolVersion` | `1`, `2` | 正整数文本，无 leading zero |
| `ContentCompatibilityVersion` | `1`, `2` | 同上 |

**注意**：`GameBuildId` 比 `ModuleId` 宽松——允许大写、`_`、单段：

```csharp
static class GameBuildIdentifier
{
    public static bool IsValid(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128) return false;
        foreach (var character in value)
        {
            var letter = character >= 'A' && character <= 'Z' || character >= 'a' && character <= 'z';
            var digit = character >= '0' && character <= '9';
            if (!letter && !digit && character != '.' && character != '-' && character != '_')
                return false;
        }
        return true;
    }
}
```

**为什么？**

- `GameBuildId` 是**机器生成**的（如 `framework.phase1_dev-1`）——一般从 CI pipeline、git hash 派生
- `ModuleId` 是**人手写**的——需要更严格的可读性约束

### 3.3 PositiveIntegerVersion — 严苛的整数解析

```csharp
static class PositiveIntegerVersion
{
    public static bool TryParse(string value, out int result)
    {
        result = 0;
        if (string.IsNullOrEmpty(value) || value[0] == '0') return false;  // ← 拒绝前导 0
        foreach (var character in value)
        {
            if (character < '0' || character > '9') return false;
        }
        return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out result)
            && result > 0;
    }
}
```

**测试断言了所有边界**：

```csharp
[TestCase(" 1")]    // 前导空格
[TestCase("1 ")]    // 尾部空格
[TestCase("+1")]    // 带正号
[TestCase("01")]    // leading zero
[TestCase("0")]     // 零
[TestCase("-1")]    // 负数
public void Integer_compatibility_versions_require_canonical_positive_decimal_text(string value)
{
    Assert.That(NetworkProtocolVersion.TryParse(value, out _), Is.False);
}
```

**为什么要这么严？** 因为这些版本号会进入网络协议——如果两端解析规则不一致（比如一台接受 `+1`、另一台拒绝），握手会失败。

### 3.4 ModApiVersion 能表达"当前"和"未来"

`ModApiVersion` 当前是 `0.1.0`，但 `SemanticVersion` 能表达任何 major。文档明确说：

> "the currently shipped API is pre-1.0 (configured as 0.1.0) is a **release policy**, not a restriction encoded in this value type."

测试断言了**未来 major** 也能用：

```csharp
var compatibility = new FrameworkCompatibility(
    GameBuildId.Parse("framework.future.dev"),
    ModApiVersion.Parse("2.0.0"),                    // ← 未来 major
    NetworkProtocolVersion.Parse("1"),
    ContentCompatibilityVersion.Parse("1"));
Assert.That(compatibility.IsValid, Is.True);
Assert.That(compatibility.ModApi.ToString(), Is.EqualTo("2.0.0"));
```

**这是个好做法**：值类型设计要"超过当前需求"，避免将来发现"啊这类型只能存 0.x 版本"。

### 3.5 这个模式的实际应用

```csharp
// 一个典型的"是否加载 Mod"判断逻辑（伪代码）
public bool ShouldLoad(FrameworkCompatibility gameCompat, FrameworkCompatibility modCompat)
{
    return gameCompat.GameBuild == modCompat.GameBuild          // 同一游戏 build
        && gameCompat.NetworkProtocol == modCompat.NetworkProtocol  // 网络协议一致
        && gameCompat.Content == modCompat.Content              // 内容兼容
        && gameCompat.ModApi.IsCompatibleWith(modCompat.ModApi); // Mod API 在兼容范围
}
```

这种判断**必须是精确比较**而不是模糊比较——否则 Mod 加载会变成"玄学"。

---

## 4. RuntimeIdentifiers — Guid-based ID

**文件**：`RuntimeIdentifiers.cs`

### 4.1 4 个 Guid 类型

| 类型 | 用途 | 例子 |
|---|---|---|
| `SessionId` | 会话标识 | 一次 multiplayer session 的 ID |
| `FiberId` | Module fiber标识 | 一个模块加载实例的 ID（同一模块可加载多次） |
| `CorrelationId` | 跨模块/跨网络追踪 ID | 串联一个用户操作触发的多个事件 |
| `LifecycleEpisodeId` | 一次完整的加载→激活→卸载事件 | 调试时定位"那一次失败的激活" |

**4 个结构体代码完全相同**——同一模式的 4 个应用。

### 4.2 为什么用 N format？

```csharp
public override string ToString() => IsValid ? value.ToString("N") : string.Empty;
```

**`N` format** = 32 个十六进制字符，无连字符：

```
"a1b2c3d4e5f6789012345678abcdef0"     ← N format
"a1b2c3d4-e5f6-7890-1234-5678abcdef0"  ← D format（默认）
```

**选择 `N` 的原因**：

| 场景 | N 优势 |
|---|---|
| 文件名 | `N` 安全，`D` 含 `-` 也安全但更长 |
| URL | `N` 紧凑 |
| 跨文化 | `N` 只含 hex，零歧义 |
| 日志可读性 | 牺牲一点（无分组），换紧凑 |

### 4.3 Guid.Empty 拒绝

```csharp
public bool IsValid => value != Guid.Empty;
```

和 Primitives 其它类型一致——`default(...)` 必须无效。

### 4.4 TryParse 拒绝空字符串和 Guid.Empty

```csharp
public static bool TryParse(string text, out Guid value)
{
    if (Guid.TryParseExact(text, "N", out value) && value != Guid.Empty)
        return true;
    value = Guid.Empty;
    return false;
}
```

`Guid.TryParseExact("00000000000000000000000000000000", "N", out var g)` 会成功（返回 true 且 `g == Guid.Empty`）——所以**必须**额外检查 `value != Guid.Empty`。

---

## 5. DiagnosticValues — 诊断原语

**文件**：`Core/Primitives/Diagnostics/DiagnosticValues.cs`

### 5.1 完整的诊断事件模型

```csharp
public DiagnosticEvent(
    DateTimeOffset timestamp,
    DiagnosticSeverity severity,
    DiagnosticEventName name,
    CorrelationId correlationId,
    SessionId? sessionId = null,
    ModuleId? moduleId = null,
    FiberId? fiberId = null,
    LifecycleEpisodeId? lifecycleEpisodeId = null,
    CapabilityKey? capabilityKey = null,
    DiagnosticAttributeSet attributes = null,
    DiagnosticError? error = null)
```

**10 个字段**——**这是一个精心设计的"事件"模型**：

| 字段 | 必填 | 用途 |
|---|---|---|
| `timestamp` | ✅ | 何时发生 |
| `severity` | ✅ | 多严重（Trace→Critical） |
| `name` | ✅ | 什么事件（namespaced） |
| `correlationId` | ✅ | 串联相关事件 |
| `sessionId` | 可选 | 哪次会话 |
| `moduleId` | 可选 | 哪个模块 |
| `fiberId` | 可选 | 哪个 fiber |
| `lifecycleEpisodeId` | 可选 | 哪次生命周期事件 |
| `capabilityKey` | 可选 | 哪个能力 |
| `attributes` | 可选 | 附加 KV（不可变 + 验证） |
| `error` | 可选 | 异常信息 |

**全部可选字段都用 `Nullable<T>`（`T?`）**——这样默认构造的 `DiagnosticEvent` 必须**显式指定至少一个上下文**，否则就是 invalid。

### 5.2 DiagnosticAttributeSet — 不可变 + 验证 + 去重

```csharp
public sealed class DiagnosticAttributeSet : IReadOnlyList<DiagnosticAttribute>
{
    readonly DiagnosticAttribute[] items;
    public DiagnosticAttributeSet(IEnumerable<DiagnosticAttribute> attributes)
    {
        items = attributes?.ToArray() ?? Array.Empty<DiagnosticAttribute>();
        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < items.Length; index++)
        {
            if (!items[index].IsValid)
                throw new ArgumentException($"Diagnostic attribute at index {index} is invalid...", nameof(attributes));
            if (!keys.Add(items[index].Key))
                throw new ArgumentException($"Diagnostic attribute key '{items[index].Key}' is duplicated...", nameof(attributes));
        }
    }
    // ...
}
```

**4 个不变量**：

1. **不可变**：`items` 是 `readonly` + 数组（不能修改元素）
2. **每个 attribute 必须 valid**：`IsValid == false` 直接抛
3. **Key 唯一**：HashSet 检测重复
4. **null 输入 = 空集**：`?? Array.Empty<>()`

**这是 `IReadOnlyList<T>` 的实现**——既能枚举（`foreach`），也能按下标访问（`[i]`）。

### 5.3 测试覆盖的微妙点

测试断言了一个**特别容易踩坑**的属性：

```csharp
[Test]
public void Diagnostic_values_validate_attribution_and_copy_attributes()
{
    var source = new[] { new DiagnosticAttribute("framework.state", "starting") };
    var attributes = new DiagnosticAttributeSet(source);
    source[0] = new DiagnosticAttribute("framework.state", "mutated");   // ← 改外部数组！

    // ... 构造 DiagnosticEvent 用 attributes ...

    Assert.That(diagnosticEvent.Attributes[0].Value, Is.EqualTo("starting"));  // ← 不受外部影响
}
```

**为什么这个测试重要？**

`DiagnosticAttributeSet` 构造函数里 `items = attributes?.ToArray()`——**不是** `attributes.ToList()`。区别：

```csharp
var source = new[] { new DiagnosticAttribute("framework.state", "starting") };
var asArray = source.ToArray();        // ← 拷贝，修改 source 不影响 asArray
var asList = source.ToList();          // ← List 是可变包装，修改 source 不影响 asList（List 内部是数组）
```

**等等，`source.ToList()` 也拷贝了？** 是的，但 `List<T>` 本身可变。如果有人保留 List 引用并调用 `Add`，就会污染 `DiagnosticAttributeSet` 内部。所以 **`ToArray()` 是更安全的不可变封装**。

**再加上 `IReadOnlyList<T>`** 接口——外部拿到这个接口的代码**无法**调用 `Add`/`Remove`，强制只读。

### 5.4 这套诊断模型的实现价值

**类比 OpenTelemetry 的 Span 模型**：

```csharp
// 伪代码：发一个事件
var evt = new DiagnosticEvent(
    DateTimeOffset.UtcNow,
    DiagnosticSeverity.Warning,
    DiagnosticEventName.Parse("framework.module.load.failed"),
    CorrelationId.New(),
    SessionId: currentSession,
    ModuleId: ModuleId.Parse("author.module-x"),
    FiberId: fiber.FiberId,
    Attributes: new DiagnosticAttributeSet(new[] {
        new DiagnosticAttribute("module.error", "Missing required capability 'world.physics'"),
        new DiagnosticAttribute("module.retry-count", "3"),
    }));
diagnostics.Emit(evt);
```

**所有字段都是 immutable struct**——一旦构造就**线程安全**，无需加锁。

---

## 6. 跨文件的统一模式

读完所有 4 个文件，发现作者贯彻了 **5 个统一模式**：

### 模式 1：readonly struct 作为值对象

```csharp
public readonly struct X : IEquatable<X>
{
    readonly T value;
    X(T value) => this.value = value;          // ← 私有构造
    public bool IsValid => /* not default */;
    public static X Parse(...) { ... }
    public static bool TryParse(..., out X) { ... }
}
```

**这种模式几乎适用于所有 ID 类型**：用户 ID、订单号、UUID、外部系统引用键。

### 模式 2：Parse + TryParse 双路径

.NET 标准约定。**`Parse` 用于"必须成功"，`TryParse` 用于"用户输入可能无效"**。

### 模式 3：Ordinal 比较 + FNV-1a hash

**两个底层工具**保证跨进程、跨文化稳定：

```csharp
public bool Equals(X other) => string.Equals(value, other.value, StringComparison.Ordinal);
public override int GetHashCode() => StableStringHash.Compute(value);
```

### 模式 4：默认值 = 无效

所有 readonly struct 都有 `IsValid` 属性，且 `default(X).IsValid == false`。
**好处**：编译器友好的 null safety——`if (id.IsValid) { use(id); }` 模式。

### 模式 5：构造时验证 + 失败抛异常

```csharp
public X(T value)
{
    if (!IsValidPredicate(value))
        throw new ArgumentException("...", "value");
    this.value = value;
}
```

**理由**：值对象一旦构造好就**不应该有非法状态**。运行时检查 `if (!x.IsValid)` 是 fallback，**不是正常路径**。

---

## 7. 我对 Primitives 层的整体评价

### 优点

1. **教科书级别的 SemVer 实现**——处理了 build metadata、leading-zero、大数溢出这些坑
2. **跨进程稳定**——FNV-1a + N format Guid + Ordinal 比较
3. **类型安全做得到位**——`ModuleId` vs `CapabilityKey` vs `CapabilityVersion` 都有专门类型
4. **测试覆盖深**——`CompatibilityTests` 涵盖 SemVer 优先级链、大数比较、整数解析边界
5. **文档即契约**——每个类型顶部都有 5-15 行 doc comment 解释"为什么这样设计"

### 可借鉴的设计模式

| 模式 | 适用场景 | 学习难度 |
|---|---|---|
| readonly struct + 私有构造 + Parse/TryParse | **任何 ID 类型** | 🟢 简单 |
| FNV-1a hash 替代 `GetHashCode()` | 需要跨进程稳定 hash 的场景 | 🟢 简单 |
| SemVer 优先级 vs 总序 vs Identity 三分离 | 任何版本号管理 | 🟡 中等 |
| 拆分 4 个兼容性维度 | 复杂系统的版本管理 | 🟡 中等 |
| 不可变 + 验证的 `AttributeSet` | 任何 K-V 属性包 | 🟡 中等 |

### 局限与可改进点

1. **`NamespacedIdentifier.IsValid` 不支持 Unicode**——只能 a-z。中文/日文作者要传 ID 怎么办？spec 没明说，看起来是有意为之（强制 ASCII 跨文化稳定）。
2. **`StableStringHash` 没有 avalanche 步骤**——FNV-1a 在大量相似输入下分布不如 xxHash。但对命名空间 ID 来说够用。
3. **`ModApiVersion` 用 `PrecedenceComparer`** 但没暴露"IsCompatibleWith(range)"这种 range 检查——下一步可能要在更高的 CapabilityContracts 层补。

---

## 8. 与 Unity 生态的整合点

虽然 Primitives 是纯 C#（不依赖 Unity），但设计上考虑了 Unity：

- `readonly struct` → **零分配**，IL2CPP 友好（AOT 编译）
- `IEquatable<T>` 实现 → **避免装箱**，Dictionary 查找更快
- `Nullable<T>` 用于 optional 字段 → **比 nullable reference types 更显式**，且跨语言/跨序列化友好
- 不依赖任何 `UnityEngine.*` → **可以单元测试**（测试程序集无需 PlayMode）

---

## 9. 关键 takeaway

读完 Primitives 这层，最大的认知收获是：

> **稳定的"小类型"是整个系统的基石**。
>
> 当 ID、版本、hash 这些"看不见的基础设施"做得够扎实时，上层的依赖解析、网络协议、存档兼容性都能省下大量 corner case 处理。

具体到这个项目：
- **依赖解析** = `ModuleId` + `CapabilityKey` + `SemanticVersion.PrecedenceComparer` 的组合
- **网络协议** = `GameBuildId` + `NetworkProtocolVersion` + `SessionId` + `CorrelationId` 的组合
- **存档** = `ContentCompatibilityVersion` + 上面所有
- **诊断** = `DiagnosticEvent` + 所有 IDs 作为 optional context

---

## 参考链接

- [SemVer 2.0.0 规范第 11 节](https://semver.org/spec/v2.0.0.html#spec-item-11)
- [FNV-1a 维基百科](http://www.isthe.com/chongo/tech/comp/fnv/)
- [.NET Core 2.1 string.GetHashCode randomization](https://github.com/dotnet/runtime/issues/25787)
- [VContainer 文档](https://vcontainer.hadotakanobu.com/)
- [HybridCLR 文档](https://github.com/focus-creative-games/hybridclr)

---

**下一步**：读 [Bootstrap 架构笔记](./03-Bootstrap-Architecture.md)，看这些 Primitives 是怎么被用起来的——VContainer scope、App/Session 生命周期状态机、主线程约束。