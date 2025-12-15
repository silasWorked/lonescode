// Инициализация Monaco Editor
let editor;
let currentFile = null;
let openTabs = new Map(); // filePath -> { content, modified }
let rootPath = null;
let isLoadingFile = false; // Флаг для игнорирования программных изменений
let autoSaveTimer = null; // Таймер автосохранения

// Загрузка Monaco Editor
require.config({ paths: { vs: 'node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '// Добро пожаловать в LonesCode IDE\n// Откройте папку для начала работы',
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 14,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    wordWrap: 'on'
  });

  // Отслеживание изменений для статус-бара
  editor.onDidChangeCursorPosition((e) => {
    document.getElementById('status-line-col').textContent = 
      `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });

  // Отслеживание изменений контента
  editor.onDidChangeModelContent(() => {
    // Игнорируем изменения при программной загрузке файла
    if (isLoadingFile) return;
    
    if (currentFile) {
      const tab = openTabs.get(currentFile);
      if (tab) {
        tab.modified = true;
        updateTabTitle(currentFile);
        
        // Сбрасываем таймер автосохранения
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        
        // Новый таймер - сохраняем через 1.5 секунды
        autoSaveTimer = setTimeout(() => {
          autoSaveFile();
        }, 1500);
      }
    }
  });
});

// Открытие папки
document.getElementById('open-folder-btn').addEventListener('click', async () => {
  const folderPath = await window.electronAPI.openFolder();
  if (folderPath) {
    rootPath = folderPath;
    await loadDirectory(folderPath, document.getElementById('file-tree'));
    document.getElementById('new-file-btn').disabled = false;
  }
});

// Загрузка содержимого директории
async function loadDirectory(dirPath, container, level = 0) {
  container.innerHTML = '';
  
  try {
    const entries = await window.electronAPI.readDirectory(dirPath);
    
    // Сортировка: сначала папки, потом файлы
    entries.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });

    for (const entry of entries) {
      const itemWrapper = createFileTreeItem(entry, level);
      container.appendChild(itemWrapper);
    }
  } catch (error) {
    console.error('Ошибка чтения директории:', error);
    container.innerHTML = '<div class="error">Ошибка загрузки файлов</div>';
  }
}

// Создание элемента дерева файлов
function createFileTreeItem(entry, level) {
  const wrapper = document.createElement('div');
  
  const item = document.createElement('div');
  item.className = 'file-item';
  item.style.paddingLeft = `${level * 16 + 8}px`;
  item.dataset.path = entry.path;
  
  const icon = entry.isDirectory ? '📁' : '📄';
  item.innerHTML = `<span class="file-icon">${icon}</span><span class="file-label">${entry.name}</span>`;
  
  wrapper.appendChild(item);
  
  if (entry.isDirectory) {
    item.classList.add('folder');
    
    const childContainer = document.createElement('div');
    childContainer.className = 'file-children';
    childContainer.style.display = 'none';
    
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      
      if (childContainer.style.display === 'none') {
        // Раскрыть папку
        if (childContainer.children.length === 0) {
          await loadDirectory(entry.path, childContainer, level + 1);
        }
        childContainer.style.display = 'block';
        item.querySelector('.file-icon').textContent = '📂';
      } else {
        // Свернуть папку
        childContainer.style.display = 'none';
        item.querySelector('.file-icon').textContent = '📁';
      }
    });
    
    // Контекстное меню для папки
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, entry.path, true);
    });
    
    wrapper.appendChild(childContainer);
  } else {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      openFile(entry.path);
    });
    
    // Контекстное меню для файла
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, entry.path, false);
    });
  }
  
  return wrapper;
}

// Открытие файла
async function openFile(filePath) {
  try {
    // Если файл уже открыт, просто переключаемся на его таб
    if (openTabs.has(filePath)) {
      switchToTab(filePath);
      return;
    }

    const content = await window.electronAPI.readFile(filePath);
    
    // Определение языка по расширению
    const ext = filePath.split('.').pop().toLowerCase();
    const language = getLanguageByExtension(ext);
    
    // Сохранение текущего содержимого перед открытием нового файла
    if (currentFile && openTabs.has(currentFile)) {
      openTabs.get(currentFile).content = editor.getValue();
    }
    
    // Сохранение в открытые табы
    openTabs.set(filePath, { content, modified: false });
    
    // Создание таба
    createTab(filePath);
    
    // Установка контента в редактор
    currentFile = filePath;
    isLoadingFile = true;
    editor.setValue(content);
    monaco.editor.setModelLanguage(editor.getModel(), language);
    isLoadingFile = false;
    
    // Обновление UI
    updateCurrentFileDisplay(filePath);
    updateStatusBar(language);
    document.getElementById('save-file-btn').disabled = false;
    document.getElementById('save-as-btn').disabled = false;
  } catch (error) {
    console.error('Ошибка открытия файла:', error);
    alert('Не удалось открыть файл');
  }
}

// Определение языка по расширению
function getLanguageByExtension(ext) {
  const languageMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'scss': 'scss',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'sql': 'sql',
    'xml': 'xml',
    'md': 'markdown',
    'sh': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml'
  };
  
  return languageMap[ext] || 'plaintext';
}

// Создание таба
function createTab(filePath) {
  const tabsContainer = document.getElementById('tabs-container');
  const tab = document.createElement('div');
  tab.className = 'tab active';
  tab.dataset.path = filePath;
  
  const fileName = filePath.split(/[\\/]/).pop();
  tab.innerHTML = `
    <span class="tab-label">${fileName}</span>
    <span class="tab-close" data-path="${filePath}">×</span>
  `;
  
  // Переключение на таб
  tab.querySelector('.tab-label').addEventListener('click', () => {
    switchToTab(filePath);
  });
  
  // Закрытие таба
  tab.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(filePath);
  });
  
  tabsContainer.appendChild(tab);
  
  // Деактивация других табов
  document.querySelectorAll('.tab').forEach(t => {
    if (t !== tab) t.classList.remove('active');
  });
}

// Переключение на таб
function switchToTab(filePath) {
  const tab = openTabs.get(filePath);
  if (!tab) return;
  
  // Сохраняем текущее содержимое перед переключением
  if (currentFile && openTabs.has(currentFile)) {
    openTabs.get(currentFile).content = editor.getValue();
  }
  
  currentFile = filePath;
  isLoadingFile = true;
  editor.setValue(tab.content);
  isLoadingFile = false;
  
  const ext = filePath.split('.').pop().toLowerCase();
  const language = getLanguageByExtension(ext);
  monaco.editor.setModelLanguage(editor.getModel(), language);
  
  updateCurrentFileDisplay(filePath);
  updateStatusBar(language);
  
  // Обновление активного таба в UI
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.path === filePath);
  });
}

// Закрытие таба
function closeTab(filePath) {
  const tab = openTabs.get(filePath);
  
  if (tab && tab.modified) {
    if (!confirm('Файл изменен. Закрыть без сохранения?')) {
      return;
    }
  }
  
  openTabs.delete(filePath);
  
  // Удаление таба из UI - используем прямой поиск по всем табам
  const tabs = document.querySelectorAll('.tab');
  let tabElement = null;
  tabs.forEach(t => {
    if (t.dataset.path === filePath) {
      tabElement = t;
    }
  });
  
  if (tabElement) {
    tabElement.remove();
  }
  
  // Переключение на другой открытый таб или очистка редактора
  if (currentFile === filePath) {
    const remainingTabs = Array.from(openTabs.keys());
    if (remainingTabs.length > 0) {
      switchToTab(remainingTabs[remainingTabs.length - 1]);
    } else {
      currentFile = null;
      editor.setValue('');
      updateCurrentFileDisplay('');
      document.getElementById('save-file-btn').disabled = true;
      document.getElementById('save-as-btn').disabled = true;
    }
  }
}

// Создание нового файла
document.getElementById('new-file-btn').addEventListener('click', async () => {
  if (!rootPath) {
    alert('Откройте папку для создания файла');
    return;
  }
  
  showFileDialog();
});

// Функция для показа диалога создания файла
function showFileDialog() {
  const dialog = document.getElementById('new-file-dialog');
  const input = document.getElementById('new-file-input');
  const okBtn = document.getElementById('dialog-ok-btn');
  const cancelBtn = document.getElementById('dialog-cancel-btn');
  
  dialog.classList.remove('hidden');
  input.value = '';
  input.focus();
  
  // Обработчик OK
  const handleOk = async () => {
    const fileName = input.value.trim();
    if (!fileName) {
      alert('Введите имя файла');
      input.focus();
      return;
    }
    
    closeFileDialog();
    await createNewFile(fileName);
  };
  
  // Обработчик отмены
  const handleCancel = () => {
    closeFileDialog();
  };
  
  // Убираем старые обработчики
  okBtn.replaceWith(okBtn.cloneNode(true));
  cancelBtn.replaceWith(cancelBtn.cloneNode(true));
  
  // Добавляем новые обработчики
  document.getElementById('dialog-ok-btn').addEventListener('click', handleOk);
  document.getElementById('dialog-cancel-btn').addEventListener('click', handleCancel);
  
  // Enter для подтверждения
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleOk();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  });
}

function closeFileDialog() {
  const dialog = document.getElementById('new-file-dialog');
  dialog.classList.add('hidden');
}

function showRenameDialog(currentName) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('rename-file-dialog');
    const input = document.getElementById('rename-file-input');
    const okBtn = document.getElementById('rename-ok-btn');
    const cancelBtn = document.getElementById('rename-cancel-btn');
    
    dialog.classList.remove('hidden');
    input.value = currentName;
    input.focus();
    input.select();
    
    const handleOk = () => {
      const newName = input.value.trim();
      if (newName) {
        closeRenameDialog();
        resolve(newName);
      } else {
        alert('Введите имя файла');
        input.focus();
      }
    };
    
    const handleCancel = () => {
      closeRenameDialog();
      resolve(null);
    };
    
    // Убираем старые обработчики
    okBtn.replaceWith(okBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    
    // Добавляем новые обработчики
    document.getElementById('rename-ok-btn').addEventListener('click', handleOk);
    document.getElementById('rename-cancel-btn').addEventListener('click', handleCancel);
    
    // Enter для подтверждения
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleOk();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    });
  });
}

function closeRenameDialog() {
  const dialog = document.getElementById('rename-file-dialog');
  dialog.classList.add('hidden');
}

async function createNewFile(fileName) {
  try {
    const filePath = rootPath + '\\' + fileName;
    await window.electronAPI.createFile(filePath);
    
    // Перезагружаем дерево файлов
    await loadDirectory(rootPath, document.getElementById('file-tree'));
    
    // Открываем только что созданный файл
    await openFile(filePath);
    
    console.log('Файл создан:', filePath);
  } catch (error) {
    console.error('Ошибка создания файла:', error);
    alert('Не удалось создать файл: ' + error.message);
  }
}

// Контекстное меню
let contextMenuPath = null;
let contextMenuIsDir = false;

function showContextMenu(e, filePath, isDir) {
  contextMenuPath = filePath;
  contextMenuIsDir = isDir;
  
  const menu = document.getElementById('file-context-menu');
  menu.classList.remove('hidden');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
}

function hideContextMenu() {
  const menu = document.getElementById('file-context-menu');
  menu.classList.add('hidden');
  contextMenuPath = null;
}

// Обработчики контекстного меню
document.getElementById('file-context-menu').addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  
  if (action === 'delete') {
    if (confirm('Удалить ' + (contextMenuIsDir ? 'папку' : 'файл') + '?')) {
      try {
        await window.electronAPI.deletePath(contextMenuPath);
        
        // Закрываем вкладку если это открытый файл
        if (!contextMenuIsDir && openTabs.has(contextMenuPath)) {
          closeTab(contextMenuPath);
        }
        
        // Перезагружаем дерево файлов
        await loadDirectory(rootPath, document.getElementById('file-tree'));
        console.log('Удалено:', contextMenuPath);
      } catch (error) {
        alert('Ошибка удаления: ' + error.message);
      }
    }
  } else if (action === 'rename') {
    // Извлекаем текущее имя файла из пути
    const currentName = contextMenuPath.substring(contextMenuPath.lastIndexOf('\\') + 1);
    
    // Показываем диалог переименования
    const newName = await showRenameDialog(currentName);
    
    if (newName && newName !== currentName) {
      try {
        const dir = contextMenuPath.substring(0, contextMenuPath.lastIndexOf('\\'));
        const newPath = dir + '\\' + newName;
        
        console.log('Переименовываю:', contextMenuPath, '->', newPath);
        await window.electronAPI.renameFile(contextMenuPath, newPath);
        
        // Закрываем и переоткрываем файл если он открыт
        if (!contextMenuIsDir && openTabs.has(contextMenuPath)) {
          const tab = openTabs.get(contextMenuPath);
          openTabs.delete(contextMenuPath);
          openTabs.set(newPath, tab);
          
          if (currentFile === contextMenuPath) {
            currentFile = newPath;
            updateCurrentFileDisplay(newPath);
          }
        }
        
        // Перезагружаем дерево файлов
        await loadDirectory(rootPath, document.getElementById('file-tree'));
        console.log('Переименовано успешно:', contextMenuPath, '->', newPath);
      } catch (error) {
        console.error('Ошибка переименования:', error);
        alert('Не удалось переименовать: ' + error.message);
      }
    }
  } else if (action === 'copy-path') {
    // Копируем путь в буфер обмена
    navigator.clipboard.writeText(contextMenuPath).then(() => {
      console.log('Путь скопирован:', contextMenuPath);
    });
  }
  
  hideContextMenu();
});

// Закрытие меню при клике вне его
document.addEventListener('click', () => {
  hideContextMenu();
});

// Сохранение файла
document.getElementById('save-file-btn').addEventListener('click', async () => {
  if (!currentFile) return;
  
  try {
    const content = editor.getValue();
    console.log('Сохраняю файл:', currentFile);
    await window.electronAPI.saveFile(currentFile, content);
    
    const tab = openTabs.get(currentFile);
    if (tab) {
      tab.content = content;
      tab.modified = false;
      updateTabTitle(currentFile);
    }
    
    // Показываем уведомление в статус-баре
    const statusBar = document.getElementById('status-line-col');
    statusBar.textContent = '✓ Сохранено';
    setTimeout(() => {
      if (editor) {
        const position = editor.getPosition();
        statusBar.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
      }
    }, 2000);
    console.log('Файл успешно сохранен');
  } catch (error) {
    console.error('Ошибка сохранения файла:', error);
    alert('Не удалось сохранить файл: ' + error.message);
  }
});

// Обновление заголовка таба
function updateTabTitle(filePath) {
  const tabElement = document.querySelector(`.tab[data-path="${filePath}"]`);
  if (!tabElement) return;
  
  const tab = openTabs.get(filePath);
  const fileName = filePath.split(/[\\/]/).pop();
  const label = tabElement.querySelector('.tab-label');
  
  if (tab && tab.modified) {
    label.textContent = `● ${fileName}`;
  } else {
    label.textContent = fileName;
  }
}

// Обновление отображения текущего файла
function updateCurrentFileDisplay(filePath) {
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Без названия';
  document.getElementById('current-file-name').textContent = fileName;
}

// Обновление статус-бара
function updateStatusBar(language) {
  const languageNames = {
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'python': 'Python',
    'html': 'HTML',
    'css': 'CSS',
    'json': 'JSON',
    'markdown': 'Markdown',
    'plaintext': 'Plain Text'
  };
  
  document.getElementById('status-language').textContent = 
    languageNames[language] || language;
}

// Горячие клавиши
document.addEventListener('keydown', (e) => {
  // Ctrl+S - сохранить
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    if (currentFile) {
      document.getElementById('save-file-btn').click();
    }
  }
  
  // Ctrl+W - закрыть таб
  if (e.ctrlKey && e.key === 'w') {
    e.preventDefault();
    if (currentFile) {
      closeTab(currentFile);
    }
  }
  
  // Ctrl+F - открыть поиск (встроенный Monaco)
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    if (editor) {
      editor.getAction('editor.action.startFindAction').run();
    }
  }
  
  // Ctrl+H - открыть замену (встроенный Monaco)
  if (e.ctrlKey && e.key === 'h') {
    e.preventDefault();
    if (editor) {
      editor.getAction('editor.action.startFindReplaceAction').run();
    }
  }
  
  // Ctrl+G - перейти на строку
  if (e.ctrlKey && e.key === 'g') {
    e.preventDefault();
    if (editor) {
      editor.getAction('editor.action.gotoLine').run();
    }
  }
  
  // Ctrl+/ - комментировать строку
  if (e.ctrlKey && e.key === '/') {
    e.preventDefault();
    if (editor) {
      editor.getAction('editor.action.commentLine').run();
    }
  }
});

// Автосохранение файла
async function autoSaveFile() {
  if (!currentFile) return;
  
  const tab = openTabs.get(currentFile);
  if (!tab || !tab.modified) return;
  
  try {
    const content = editor.getValue();
    await window.electronAPI.saveFile(currentFile, content);
    
    tab.content = content;
    tab.modified = false;
    updateTabTitle(currentFile);
    
    console.log('[AUTO-SAVE]', currentFile);
  } catch (error) {
    console.error('[AUTO-SAVE ERROR]', error);
  }
}
