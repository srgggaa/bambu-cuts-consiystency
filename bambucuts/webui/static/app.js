// Bambu Cuts - JavaScript Client

const API_BASE = window.location.origin;

// State
let state = {
    printerConnected: false,
    currentFileName: 'Untitled.gcode',
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Bambu Cuts...');

    attachEventListeners();
    setupEditorDragDrop();
    setupConverterDragDrop();
});

// Attach all event listeners
function attachEventListeners() {
    // Editor buttons
    document.getElementById('loadFileBtn').addEventListener('click', loadFile);
    document.getElementById('saveFileBtn').addEventListener('click', saveFile);
    document.getElementById('download3mfBtn').addEventListener('click', download3mf);

    // Filename changes
    document.getElementById('fileName').addEventListener('change', updateFileName);

    // Editor line numbers
    const editor = document.getElementById('gcodeEditor');
    editor.addEventListener('input', updateLineNumbers);
    editor.addEventListener('scroll', syncLineNumbersScroll);

    // Initial line numbers
    updateLineNumbers();
}

// Notifications
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Utility
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Editor Functions

function setupEditorDragDrop() {
    const editorWrapper = document.querySelector('.editor-wrapper');

    editorWrapper.addEventListener('dragover', (e) => {
        e.preventDefault();
        editorWrapper.classList.add('drag-over');
    });

    editorWrapper.addEventListener('dragleave', (e) => {
        e.preventDefault();
        editorWrapper.classList.remove('drag-over');
    });

    editorWrapper.addEventListener('drop', (e) => {
        e.preventDefault();
        editorWrapper.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.gcode') || file.name.endsWith('.nc') || file.name.endsWith('.txt')) {
                readFileContent(file);
            } else {
                showNotification('Please drop a .gcode, .nc, or .txt file', 'warning');
            }
        }
    });
}

function readFileContent(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('gcodeEditor').value = e.target.result;
        state.currentFileName = file.name;
        document.getElementById('fileName').value = file.name;
        updateLineNumbers();
        showNotification(`Loaded ${file.name}`, 'success');
    };
    reader.onerror = () => {
        showNotification('Failed to read file', 'error');
    };
    reader.readAsText(file);
}

function loadFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode,.nc,.txt';
    input.style.display = 'none';

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            readFileContent(file);
        }
        document.body.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
}

function saveFile() {
    const content = document.getElementById('gcodeEditor').value;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.currentFileName;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`Saved ${state.currentFileName}`, 'success');
}

async function sendAllGcode() {
    const content = document.getElementById('gcodeEditor').value;
    const filename = document.getElementById('fileName').value;

    if (!content.trim()) {
        showNotification('Editor is empty', 'warning');
        return;
    }

    if (!confirm('Convert to 3MF and start print?')) {
        return;
    }

    try {
        showNotification('Converting to 3MF...', 'info');

        const response = await fetch(`${API_BASE}/api/gcode/send-all-3mf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gcode: content, filename: filename })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Successfully uploaded and started ${data.filename}`, 'success');
        } else {
            showNotification(`Upload failed: ${data.error}`, 'error');
            console.error('Errors:', data.errors);
        }
    } catch (error) {
        console.error('Send all error:', error);
        showNotification('Failed to send G-code', 'error');
    }
}

async function sendAllGcodeDirect() {
    const content = document.getElementById('gcodeEditor').value;

    if (!content.trim()) {
        showNotification('Editor is empty', 'warning');
        return;
    }

    if (!confirm('Send G-code directly line-by-line to printer?')) {
        return;
    }

    try {
        showNotification('Sending G-code directly...', 'info');

        const response = await fetch(`${API_BASE}/api/gcode/send-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gcode: content })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Successfully sent ${data.sent_count} G-code lines`, 'success');
        } else {
            showNotification(`Send failed: ${data.error || 'Unknown error'}`, 'error');
            if (data.errors && data.errors.length > 0) {
                console.error('Errors:', data.errors);
            }
        }
    } catch (error) {
        console.error('Send direct error:', error);
        showNotification('Failed to send G-code', 'error');
    }
}

async function download3mf() {
    const content = document.getElementById('gcodeEditor').value;
    const filename = document.getElementById('fileName').value;

    if (!content.trim()) {
        showNotification('Editor is empty', 'warning');
        return;
    }

    try {
        showNotification('Creating 3MF file...', 'info');

        const response = await fetch(`${API_BASE}/api/gcode/create-3mf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gcode: content, filename: filename })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename.replace('.gcode', '.3mf');
            a.click();
            URL.revokeObjectURL(url);
            showNotification('3MF file downloaded', 'success');
        } else {
            const data = await response.json();
            showNotification(`Download failed: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Download 3MF error:', error);
        showNotification('Failed to create 3MF file', 'error');
    }
}

function updateFileName() {
    const newName = document.getElementById('fileName').value.trim();
    if (newName) {
        state.currentFileName = newName;
    } else {
        document.getElementById('fileName').value = state.currentFileName;
    }
}

function updateLineNumbers() {
    const editor = document.getElementById('gcodeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    const lines = editor.value.split('\n');
    const lineCount = lines.length;

    let numbers = '';
    for (let i = 1; i <= lineCount; i++) {
        numbers += i + '\n';
    }

    lineNumbers.textContent = numbers;
}

function syncLineNumbersScroll() {
    const editor = document.getElementById('gcodeEditor');
    const lineNumbers = document.getElementById('lineNumbers');
    lineNumbers.scrollTop = editor.scrollTop;
}

// Converter Functions

function setupConverterDragDrop() {
    const dropzone = document.getElementById('converterDropzone');
    const fileInput = document.getElementById('converterFileInput');

    dropzone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleConverterFile(file);
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.svg') || file.name.endsWith('.dxf')) {
                handleConverterFile(file);
            } else {
                showConverterStatus('Please drop a .svg or .dxf file', 'error');
            }
        }
    });
}

async function handleConverterFile(file) {
    const fileName = file.name;
    const fileExtension = fileName.split('.').pop().toLowerCase();

    showConverterStatus(`Processing ${fileName}...`, 'processing');

    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_type', fileExtension);

        const response = await fetch(`${API_BASE}/api/convert-to-gcode`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            document.getElementById('gcodeEditor').value = data.gcode;
            updateLineNumbers();

            const newFileName = fileName.replace(`.${fileExtension}`, '.gcode');
            state.currentFileName = newFileName;
            document.getElementById('fileName').value = newFileName;

            showConverterStatus(`✓ Converted ${fileName} to G-code (${data.line_count} lines)`, 'success');
            showNotification(`Converted ${fileName} successfully`, 'success');
        } else {
            showConverterStatus(`✗ Conversion failed: ${data.error}`, 'error');
            showNotification(`Conversion failed: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Converter error:', error);
        showConverterStatus(`✗ Conversion failed: ${error.message}`, 'error');
        showNotification('Conversion failed', 'error');
    }
}

function showConverterStatus(message, type) {
    const status = document.getElementById('converterStatus');
    status.textContent = message;
    status.className = 'converter-status ' + type;

    if (type !== 'processing') {
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    }
}