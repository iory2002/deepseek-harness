/** Isolated companion surface: localized status and pointer-driven window control only. */

import { contextBridge, ipcRenderer } from 'electron'
import { PET_IPC, type DesktopPetApi, type DesktopPetPresentation } from './pet-api.ts'

const api: DesktopPetApi = {
  presentation: () => ipcRenderer.invoke(PET_IPC.read) as Promise<DesktopPetPresentation>,
  onPresentation: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, presentation: DesktopPetPresentation): void => { listener(presentation) }
    ipcRenderer.on(PET_IPC.presentation, receive)
    return () => { ipcRenderer.removeListener(PET_IPC.presentation, receive) }
  },
  beginDrag: () => { ipcRenderer.send(PET_IPC.dragStart) },
  endDrag: () => { ipcRenderer.send(PET_IPC.dragEnd) },
  activate: () => { ipcRenderer.send(PET_IPC.activate) },
  openMenu: () => { ipcRenderer.send(PET_IPC.menu) },
}

contextBridge.exposeInMainWorld('dshPet', api)
