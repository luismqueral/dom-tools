export const state = {
  active: true,
  enabled: true,     // global DOM-Tools on/off (toggled via double-Esc)
  hovered: null,
  selected: [],      // {el, desc, badge}[]
  altHeld: false,
  slotType: null,    // 'before' | 'after' | 'left' | 'right' | 'inside'
  editMode: false,
  cameraMode: false,
  annotateMode: false,
  annotateSub: 'sticky', // 'pen' | 'sticky'
  stickyMode: false,
  styleModActive: false,
  handToolActive: false,
};

// Set of all inspector UI elements (ignored by hover/click)
export const inspectorUI = new Set();
