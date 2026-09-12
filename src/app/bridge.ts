/** 编辑器与预览/画布之间的轻量桥接（避免 UI 层互相 import 内部实现） */
export const editorBridge: {
  /**
   * 在源码中选中某个区间。
   * @param focus 是否把焦点移进编辑器。画布侧一律传 false —— 否则画布上的
   *   下一次按键（回车 / Delete）会作用在刚选中的源码区间上，把图改坏。
   */
  selectRange?: (from: number, to: number, opts?: { focus?: boolean }) => void;
} = {};
