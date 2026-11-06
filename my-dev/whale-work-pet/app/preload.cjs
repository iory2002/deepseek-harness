/**
 * Bridge between the standalone window and its main process.
 *
 * The renderer runs with context isolation and no Node integration, so this is
 * the complete surface it may use.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  /** @param {(state: object) => void} listener - called on every pushed state payload. */
  onState(listener) {
    ipcRenderer.on('whale:state', (_event, state) => listener(state))
  },
  /** @param {(clip: string) => void} listener - called when the menu plays one clip. */
  onPlay(listener) {
    ipcRenderer.on('whale:play', (_event, clip) => listener(clip))
  },
  /** Remember the window position at the start of a drag. */
  dragStart() {
    ipcRenderer.send('whale:drag-start')
  },
  /** Move the window by a cursor delta from the drag start, in screen pixels. */
  dragMove(dx, dy) {
    ipcRenderer.send('whale:drag-move', { dx, dy })
  },
  /** Release the drag origin. */
  dragEnd() {
    ipcRenderer.send('whale:drag-end')
  },
  /** Let clicks pass through to whatever is underneath. */
  ignoreMouse(ignore) {
    ipcRenderer.send('whale:ignore-mouse', ignore)
  },
  /** Open the DeepSeek Harness desktop application. */
  openApp() {
    ipcRenderer.send('whale:open-app')
  },
  /** Hide the window until the next launch. */
  hide() {
    ipcRenderer.send('whale:hide')
  },
  /** Open the small window menu at the cursor. */
  menu() {
    ipcRenderer.send('whale:menu')
  },
})
