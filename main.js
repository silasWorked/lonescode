const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1e1e1e',
    title: 'LonesCode IDE'
  });

  mainWindow.loadFile('index.html');
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory()
    }));
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    console.error('Error reading file:', error);
    throw error;
  }
});

ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    console.log('[SAVE] Сохраняю файл:', filePath);
    await fs.writeFile(filePath, content, 'utf-8');
    console.log('[SAVE] Файл успешно сохранен:', filePath);
    return true;
  } catch (error) {
    console.error('[SAVE ERROR]', filePath, error.message);
    throw error;
  }
});

// Создать файл
ipcMain.handle('create-file', async (event, filePath) => {
  try {
    console.log('[CREATE] Создаю файл:', filePath);
    // Сначала убедимся, что директория существует
    const dir = require('path').dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, '', 'utf-8');
    console.log('[CREATE] Файл успешно создан:', filePath);
    return true;
  } catch (error) {
    console.error('[CREATE ERROR]', filePath, error.message);
    throw error;
  }
});

// Создать папку
ipcMain.handle('create-folder', async (event, folderPath) => {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    return true;
  } catch (error) {
    console.error('Error creating folder:', error);
    throw error;
  }
});

// Удалить файл или папку
ipcMain.handle('delete-path', async (event, targetPath) => {
  try {
    console.log('[DELETE]', targetPath);
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      await fs.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.unlink(targetPath);
    }
    console.log('[DELETE SUCCESS]', targetPath);
    return true;
  } catch (error) {
    console.error('[DELETE ERROR]', targetPath, error.message);
    throw error;
  }
});

// Переименовать файл или папку
ipcMain.handle('rename-file', async (event, oldPath, newPath) => {
  try {
    console.log('[RENAME]', oldPath, '->', newPath);
    const fsPromises = require('fs').promises;
    await fsPromises.rename(oldPath, newPath);
    console.log('[RENAME SUCCESS]', oldPath, '->', newPath);
    return true;
  } catch (error) {
    console.error('[RENAME ERROR]', oldPath, error.message);
    throw error;
  }
});
