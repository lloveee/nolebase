
# 02_Matrix_Algebra

## 矩阵运算

从物理和数学的直觉上来讲，矩阵运算是为了能够快速进行批量的向量的计算。

 $m \times n$ matrix M ，即表示m行，n列的矩阵

举例如下：
$$
\mathbf {A} = \left[ \begin{array}{c c c c} 3. 5 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & 0. 5 & 0 \\ 2 & - 5 & \sqrt {2} & 1 \end{array} \right] \mathbf {B} = \left[ \begin{array}{c c} B _ {1 1} & B _ {1 2} \\ B _ {2 1} & B _ {2 2} \\ B _ {3 1} & B _ {3 2} \end{array} \right] \mathbf {u} = \left[ u _ {1}, u _ {2}, u _ {3} \right] \mathbf {v} = \left[ \begin{array}{l} 1 \\ 2 \\ \sqrt {3} \\ \pi \end{array} \right]
$$
注意特殊的u和v，作为单行/单列的矩阵，即为一个向量。

符号表示上，矩阵下标首数字表示行，次数字表示列
$$
\left[\begin{array}{c c c}A _ {1 1}&A _ {1 2}&A _ {1 3}\\A _ {2 1}&A _ {2 2}&A _ {2 3}\\A _ {3 1}&A _ {3 2}&A _ {3 3}\end{array}\right] = \left[\begin{array}{c}\leftarrow \mathbf {A} _ {1, *} \rightarrow\\\leftarrow \mathbf {A} _ {2, *} \rightarrow\\\leftarrow \mathbf {A} _ {3, *} \rightarrow\end{array}\right]
$$
$$
\left[ \begin{array}{l l l} A _ {1 1} & A _ {1 2} & A _ {1 3} \\ A _ {2 1} & A _ {2 2} & A _ {2 3} \\ A _ {3 1} & A _ {3 2} & A _ {3 3} \end{array} \right] = \left[ \begin{array}{c c c} \uparrow & \uparrow & \uparrow \\ \mathbf {A} _ {\star , 1} & \mathbf {A} _ {\star , 2} & \mathbf {A} _ {\star , 3} \\ \downarrow & \downarrow & \downarrow \end{array} \right]
$$

运算与向量极为相似，设有
$$
\mathbf {A} = \left[ \begin{array}{l l} 1 & 5 \\ - 2 & 3 \end{array} \right], \mathbf {B} = \left[ \begin{array}{l l} 6 & 2 \\ 5 & - 8 \end{array} \right], \mathbf {C} = \left[ \begin{array}{l l} 1 & 5 \\ - 2 & 3 \end{array} \right], \mathbf {D} = \left[ \begin{array}{l l l} 2 & 1 & - 3 \\ - 6 & 3 & 0 \end{array} \right]
$$
加法
$$
\mathbf {A} + \mathbf {B} = \left[ \begin{array}{l l} 1 & 5 \\ - 2 & 3 \end{array} \right] + \left[ \begin{array}{l l} 6 & 2 \\ 5 & - 8 \end{array} \right] = \left[ \begin{array}{l l} 1 + 6 & 5 + 2 \\ - 2 + 5 & 3 + (- 8) \end{array} \right] = \left[ \begin{array}{l l} 7 & 7 \\ 3 & - 5 \end{array} \right] \tag {i}
$$
常数乘法
$3 \mathbf { D } = 3 { \left[ \begin{array} { l l l } { 2 } & { 1 } & { - 3 } \\ { - 6 } & { 3 } & { 0 } \end{array} \right] } = { \left[ \begin{array} { l l l } { 3 { \left( 2 \right) } } & { 3 { \left( 1 \right) } } & { 3 { \left( - 3 \right) } } \\ { 3 { \left( - 6 \right) } } & { 3 { \left( 3 \right) } } & { 3 { \left( 0 \right) } } \end{array} \right] } = { \left[ \begin{array} { l l l } { 6 } & { 3 } & { - 9 } \\ { - 1 8 } & { 9 } & { 0 } \end{array} \right] }$ 

减法
$\mathbf { A } - \mathbf { B } = { \left[ \begin{array} { l l } { 1 } & { 5 } \\ { - 2 } & { 3 } \end{array} \right] } - { \left[ \begin{array} { l l } { 6 } & { 2 } \\ { 5 } & { - 8 } \end{array} \right] } = { \left[ \begin{array} { l l } { 1 - 6 } & { 5 - 2 } \\ { - 2 - 5 } & { 3 - \left( - 8 \right) } \end{array} \right] } = { \left[ \begin{array} { l l } { - 5 } & { 3 } \\ { - 7 } & { 1 1 } \end{array} \right] }$ 

同样具有数学性质：
1. $\mathbf { A } + \mathbf { B } = \mathbf { B } + \mathbf { A }$ 
2. $( \mathbf { A } + \mathbf { B } ) + \mathbf { C } = \mathbf { A } + ( \mathbf { B } + \mathbf { C } )$ 
3. $r ( \mathbf { A } + \mathbf { B } ) = r \mathbf { A } + r \mathbf { B }$ 
4. $( r + s ) \mathbf { A } = r \mathbf { A } + s \mathbf { A }$ 
5. $(\mathbf {A B}) \mathbf {C} = \mathbf {A} (\mathbf {B C})$

## 矩阵乘法

设A 为 $m \times n$的矩阵，B 为 $n \times p$ 的矩阵，则${A} \cdot {B}$ 结果为一个$m \times p$的矩阵，其中
$$
C _ {i j} = \mathbf {A} _ {i, *} \cdot \mathbf {B} _ {* , j} \tag {eq.2.1}
$$
特殊的：
当左边的矩阵行为1，如：
$$
\mathbf {u} \mathbf {A} = \left[ x, y, z \right] \left[ \begin{array}{l l l} A _ {1 1} & A _ {1 2} & A _ {1 3} \\ A _ {2 1} & A _ {2 2} & A _ {2 3} \\ A _ {3 1} & A _ {3 2} & A _ {3 3} \end{array} \right] = \left[ x, y, z \right] \left[ \begin{array}{l l l} \uparrow & \uparrow & \uparrow \\ \mathbf {A} _ {\star , 1} & \mathbf {A} _ {\star , 2} & \mathbf {A} _ {\star , 3} \\ \downarrow & \downarrow & \downarrow \end{array} \right]
$$
则有公式推导简化：
$$
\begin{array}{l} \mathbf {u} \mathbf {A} = \left[ \begin{array}{l l l} \mathbf {u} \cdot \mathbf {A} _ {*, 1} & \mathbf {u} \cdot \mathbf {A} _ {*, 2} & \mathbf {u} \cdot \mathbf {A} _ {*, 3} \end{array} \right] \\ = \left[ x A _ {1 1} + y A _ {2 1} + z A _ {3 1}, \quad x A _ {1 2} + y A _ {2 2} + z A _ {3 2}, \quad x A _ {1 3} + y A _ {2 3} + z A _ {3 3} \right] \\ = \left[ x A _ {1 1}, x A _ {1 2}, x A _ {1 3} \right] + \left[ y A _ {2 1}, y A _ {2 2}, y A _ {2 3} \right] + \left[ z A _ {3 1}, z A _ {3 2}, z A _ {3 3} \right] \\ = x \left[ A _ {1 1}, A _ {1 2}, A _ {1 3} \right] + y \left[ A _ {2 1}, A _ {2 2}, A _ {2 3} \right] + z \left[ A _ {3 1}, A _ {3 2}, A _ {3 3} \right] \\ = x \mathbf {A} _ {1, *} + y \mathbf {A} _ {2, *} + z \mathbf {A} _ {3, *} \\ \end{array}
$$
即：
$$
\mathbf {u} \mathbf {A} = x \mathbf {A} _ {1, *} + y \mathbf {A} _ {2, *} + z \mathbf {A} _ {3, *} \tag {eq.2.2}
$$
泛化为：
$$
\left[ u _ {1}, \dots , u _ {n} \right] \left[ \begin{array}{c c c} A _ {1 1} & \dots & A _ {1 m} \\ \vdots & \ddots & \vdots \\ A _ {n 1} & \dots & A _ {n m} \end{array} \right] = u _ {1} \mathbf {A} _ {1, *} + \dots + u _ {n} \mathbf {A} _ {n, *} \tag {eq.2.3}
$$
## 矩阵转置

符号上，我们将${ \bf M } ^ { T }$，称作矩阵${ \bf M }$的转置。

具体表示如下：
$$
\mathbf {A} = \left[ \begin{array}{c c c} 2 & - 1 & 8 \\ 3 & 6 & - 4 \end{array} \right], \mathbf {B} = \left[ \begin{array}{c c c} a & b & c \\ d & e & f \\ g & h & i \end{array} \right], \mathbf {C} = \left[ \begin{array}{c} 1 \\ 2 \\ 3 \\ 4 \end{array} \right]
$$
$$
\mathbf {A} ^ {T} = \left[ \begin{array}{l l} 2 & 3 \\ - 1 & 6 \\ 8 & - 4 \end{array} \right], \mathbf {B} ^ {T} = \left[ \begin{array}{l l l} a & d & g \\ b & e & h \\ c & f & i \end{array} \right], \mathbf {C} ^ {T} = \left[ \begin{array}{l l l l} 1 & 2 & 3 & 4 \end{array} \right]
$$
以下是常用的转置特性：
1. $( \mathbf { A } + \mathbf { B } ) ^ { T } = \mathbf { A } ^ { T } + \mathbf { B } ^ { T }$ 

2. $( c \mathbf { A } ) ^ { T } = c \mathbf { A } ^ { T }$ 

3. $( \mathbf { A } \mathbf { B } ) ^ { T } = \mathbf { B } ^ { T } \mathbf { A } ^ { T }$ 

4. $( \mathbf { A } ^ { T } ) ^ { T } = \mathbf { A }$ 

5. $( \mathbf { A } ^ { - 1 } ) ^ { T } = ( \mathbf { A } ^ { T } ) ^ { - 1 }$ 

### 单位矩阵

对于主对角线上全为1，其余为0的矩阵，我们称作单位矩阵，如下：
$$
\left[ \begin{array}{c c} 1 & 0 \\ 0 & 1 \end{array} \right], \left[ \begin{array}{c c c} 1 & 0 & 0 \\ 0 & 1 & 0 \\ 0 & 0 & 1 \end{array} \right], \left[ \begin{array}{c c c c} 1 & 0 & 0 & 0 \\ 0 & 1 & 0 & 0 \\ 0 & 0 & 1 & 0 \\ 0 & 0 & 0 & 1 \end{array} \right]
$$
对于任意$m \times n$的矩阵$A$，以及$n \times p$的矩阵$B$，对于$n \times n$的单位$I$矩阵，特性如下 
$$
\ {A I} = \ {A} \text { , } \ {I B} = \ {B}
$$
特殊的，当矩阵$U$为$n \times n$时，则有
$$
\ {U I} = \ {U} \text { , } \ {I U} = \ {U}
$$
## 矩阵子式(Matrix Minors)

定义有：给定$n \times n$的矩阵$A$，$\overline A _ {ij}$ 表示矩阵$A$去掉$i$行，$j$列后的子矩阵

表示如下：
$$A = \left[ \begin{array}{c c c} A _ {11} & A _ {12} & A _ {13} \\ A _ {21} & A _ {22} & A _ {23} \\ A _ {31} & A _ {32} & A _ {33} \end{array} \right]$$
$$\overline A _{11} = \left[ \begin{array}{c c} A _ {22} & A _ {23} \\  A _ {32} & A _ {33} \end{array} \right]$$
$$\overline A _{22} = \left[ \begin{array}{c c} A _ {11} & A _ {13} \\  A _ {31} & A _ {33} \end{array} \right]$$
$$\overline A _{13} = \left[ \begin{array}{c c} A _ {21} & A _ {22} \\  A _ {31} & A _ {32} \end{array} \right]$$

### 矩阵行列式

符号上$det \space A$表示矩阵$A$的行列式，有时也写作$|A|$。
 
#### 几何意义：它在现实/图形中代表什么？（最核心的一句）

> _"It can be shown that the determinant has a geometric interpretation related to volumes of boxes and that the determinant provides information on how volumes change under linear transformations."_

- **翻译**：可以证明，行列式在几何上与“盒子的体积”有关；并且，它能告诉我们在进行“线性变换”时，体积会发生怎样的比例变化。
    
- **大白话理解**：在做2D/3D空间变换时（比如你操作一个物体的 Transform 去做缩放、倾斜等动作），矩阵代表了这种变换的过程。
    
    - 在二维空间中（$2 \times 2$ 矩阵），行列式的值代表了变换后**面积缩放的倍数**。
        
    - 在三维空间中（$3 \times 3$ 矩阵），行列式的值就代表了变换后**体积缩放的倍数**。

#### 实际应用：它能用来干嘛？

> _"In addition, determinants are used to solve systems of linear equations using Cramer’s Rule"_

- **翻译**：此外，利用克莱姆法则（Cramer's Rule），行列式还可以用来求解线性方程组。


有计算如下：

#### 二阶矩阵（$2 \times 2$）的计算流程

这是最简单的，只需要记住一个口诀：**“主对角线乘积” 减去 “副对角线乘积”**。

假设我们有一个 $2 \times 2$ 的方阵 $A$：

$$A = \begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

- **主对角线**：从左上到右下的那条线（包含 $a$ 和 $d$）。
    
- **副对角线**：从右上到左下的那条线（包含 $b$ 和 $c$）。
    

**计算公式：**

$$\det A = ad - bc$$

**具体例子：**

$$\det \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix} = (1 \times 4) - (2 \times 3) = 4 - 6 = -2$$

---

#### 2. 三阶矩阵（$3 \times 3$）的计算流程

假设我们有一个 $3 \times 3$ 的矩阵：

$$A = \begin{pmatrix} a & b & c \\ d & e & f \\ g & h & i \end{pmatrix}$$

计算三阶行列式主要有两种常见方法：

##### 方法一：对角线法则（沙路法则 Sarrus Rule）

这个方法非常直观，但**只能用于 $3 \times 3$ 矩阵**。

1. **平移列**：把矩阵的前两列（$a, d, g$ 和 $b, e, h$）原封不动地抄写在矩阵的右边。
    
2. **主对角线相加**：画出三条从左上到右下的对角线，把线上的三个数字相乘，然后将这三组结果相加。$(aei + bfg + cdh)$
    
3. **副对角线相减**：画出三条从右上到左下的对角线，把线上的三个数字相乘，然后将这三组结果从刚才的总和中减去。$(ceg + afh + bdi)$
    

**完整公式：**

$$\det A = (aei + bfg + cdh) - (ceg + afh + bdi)$$

##### 方法二：按行/列展开（代数余子式展开）

这个方法的核心是**“降维打击”**：把一个大的 $3 \times 3$ 矩阵拆成三个小的 $2 \times 2$ 矩阵来算。这个思路极其重要，因为所有更高阶的矩阵计算都是基于这个套路。

1. **挑选一行（或一列）**：通常为了方便，我们挑第一行，也就是元素 $a, b, c$。
    
2. **处理第一个元素 $a$**：划掉 $a$ 所在的行和列，你会发现剩下了四个数字组成的 $2 \times 2$ 小矩阵 $\begin{pmatrix} e & f \\ h & i \end{pmatrix}$。计算这个小矩阵的行列式，然后乘上 $a$。
    
3. **处理第二个元素 $b$**：同样划掉 $b$ 所在的行和列，剩下 $\begin{pmatrix} d & f \\ g & i \end{pmatrix}$。计算它的小行列式乘上 $b$。**注意：展开时符号是正负交替的（$+ - +$），所以这里前面要写减号。**
    
4. **处理第三个元素 $c$**：划掉 $c$ 所在的行和列，剩下 $\begin{pmatrix} d & e \\ g & h \end{pmatrix}$。乘上 $c$，前面写加号。
    

**完整公式：**

$$\det A = a \cdot \det \begin{pmatrix} e & f \\ h & i \end{pmatrix} - b \cdot \det \begin{pmatrix} d & f \\ g & i \end{pmatrix} + c \cdot \det \begin{pmatrix} d & e \\ g & h \end{pmatrix}$$

拆解完之后，那三个 $2 \times 2$ 的小矩阵，直接套用第一部分里讲的 $(ad - bc)$ 公式计算就可以了。

---

#### 3. 更高阶矩阵（$4 \times 4$ 及以上）

如果是 $4 \times 4$ 甚至更大的矩阵，几乎很少有人纯手算，因为计算量会呈指数级增长：

- 理论上，你可以继续用**方法二（展开法）**，把 $4 \times 4$ 拆成四个 $3 \times 3$，再把每个 $3 \times 3$ 拆成 $2 \times 2$。
    
- 在实际计算机底层运算时（比如图形学引擎或算法库），通常会通过矩阵变换，把它变成一个“上三角矩阵”（对角线左下角全为0的矩阵），然后直接把主对角线上的所有数字乘起来，这就是它的行列式。这样运算效率高得多。


## 代数余子式(Cofactor), 伴随矩阵(Adjoint of a Matrix)

符号上，我们定义
$$C_{ij} = (-1)^{i+j} \det(A_{ij})$$

- $A_{ij}$：划掉第 $i$ 行和第 $j$ 列后剩下的“小矩阵”。
    
- $(-1)^{i+j}$：用来决定正负号。如果行号+列号是偶数就是正（$+$），奇数就是负（$-$）。这就是为什么我们之前展开第一行时，符号是“$+ - +$”。

我们把算出来的每一个 $C_{ij}$，都原封不动地放到它对应的第 i 行第 j 列的位置上，我们就得到了矩阵 A 的代数余子式矩阵 $C_A$

再将其转置即得到**伴随矩阵 $A^*$**。

公式表达为：

$$A^* = (C_A)^T$$

## 逆矩阵(Matrix Inverses)

