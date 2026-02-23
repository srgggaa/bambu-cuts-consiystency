#!/usr/bin/env python3
"""
Bambu Cuts - Cutter and Plotter API

A Flask API backend for controlling Bambu Lab printers as CNC cutters/plotters.
Provides RESTful endpoints for printer control, jogging, and G-code execution.

Author: AI Assistant
"""

from flask import Flask, render_template, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename
import time
import sys
import os
import tempfile
from pathlib import Path
import threading
import base64
from io import BytesIO

try:
    import bambulabs_api as bl
    from bambucuts import config
    from bambucuts.compress_3mf import process_3mf
    from bambucuts.gcodetools import GCodeTools, CuttingParameters
    from bambucuts.dxf2svg import convert_dxf_to_svg
except ImportError as e:
    print(f"Error importing required modules: {e}")
    print("Make sure bambulabs_api is installed and bambucuts is available")
    import traceback
    traceback.print_exc()
    sys.exit(1)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'a1plotter-secret-key'
CORS(app)  # Enable CORS for all routes
socketio = SocketIO(app, cors_allowed_origins="*")

@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')

@app.route('/api/gcode/validate', methods=['POST'])
def validate_gcode():
    """Validate G-code syntax."""
    data = request.json
    gcode_text = data.get('gcode', '')

    errors = []
    warnings = []
    line_num = 0

    for line in gcode_text.split('\n'):
        line_num += 1
        line = line.strip()

        # Skip empty lines and comments
        if not line or line.startswith(';'):
            continue

        # Remove inline comments
        if ';' in line:
            line = line.split(';')[0].strip()

        # Basic G-code validation
        if not line[0].upper() in ['G', 'M', 'T', 'N']:
            errors.append(f"Line {line_num}: Invalid command start '{line[0]}'")
            continue

        # Check for common issues
        if line.upper().startswith('G') or line.upper().startswith('M'):
            # Check if there's a number after G/M
            if len(line) < 2 or not line[1].isdigit():
                errors.append(f"Line {line_num}: Missing command number")

    return jsonify({
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings,
        'line_count': line_num
    })

@app.route('/api/gcode/format', methods=['POST'])
def format_gcode():
    """Format G-code with proper spacing and comments."""
    data = request.json
    gcode_text = data.get('gcode', '')

    formatted_lines = []

    for line in gcode_text.split('\n'):
        line = line.strip()

        # Keep empty lines and comments as-is
        if not line or line.startswith(';'):
            formatted_lines.append(line)
            continue

        # Split command and comment
        if ';' in line:
            code_part, comment_part = line.split(';', 1)
            code_part = code_part.strip()
            comment_part = comment_part.strip()
            formatted_lines.append(f"{code_part:<20} ; {comment_part}")
        else:
            formatted_lines.append(line)

    return jsonify({
        'formatted': '\n'.join(formatted_lines)
    })

@app.route('/api/gcode/create-3mf', methods=['POST'])
def create_3mf():
    """Create 3MF file from G-code and return for download."""
    data = request.json
    gcode_text = data.get('gcode', '')
    filename = data.get('filename', 'plot.gcode')

    if not gcode_text.strip():
        return jsonify({'success': False, 'error': 'No G-code to convert'}), 400

    # Create temporary directory for files
    temp_dir = tempfile.mkdtemp()
    temp_gcode_path = None
    temp_3mf_path = None

    try:
        # Save G-code to temporary file
        temp_gcode_path = os.path.join(temp_dir, 'temp_plot.gcode')
        with open(temp_gcode_path, 'w') as f:
            f.write(gcode_text)

        # Convert to 3MF using template
        template_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                     'template.3mf')

        if not os.path.exists(template_path):
            return jsonify({'success': False, 'error': f'Template file not found: {template_path}'}), 500

        # Generate output 3MF file
        output_3mf_name = filename.replace('.gcode', '.3mf') if filename.endswith('.gcode') else f"{filename}.3mf"
        temp_3mf_path = os.path.join(temp_dir, output_3mf_name)

        # Process 3MF
        process_3mf(template_path, temp_3mf_path, temp_gcode_path, verbose=False)

        # Return the file for download
        return send_file(
            temp_3mf_path,
            as_attachment=True,
            download_name=output_3mf_name,
            mimetype='application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
        )

    except Exception as e:
        print(f"Error in create_3mf: {e}")
        # Clean up on error
        try:
            if temp_gcode_path and os.path.exists(temp_gcode_path):
                os.remove(temp_gcode_path)
            if temp_3mf_path and os.path.exists(temp_3mf_path):
                os.remove(temp_3mf_path)
            if os.path.exists(temp_dir):
                os.rmdir(temp_dir)
        except Exception as cleanup_error:
            print(f"Error cleaning up temporary files: {cleanup_error}")

        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/convert-to-gcode', methods=['POST'])
def convert_to_gcode():
    """Convert SVG or DXF file to G-code."""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    file_type = request.form.get('file_type', '')

    if file.filename == '':
        return jsonify({'success': False, 'error': 'Empty filename'}), 400

    if file_type not in ['svg', 'dxf']:
        return jsonify({'success': False, 'error': 'Invalid file type. Only SVG and DXF are supported'}), 400

    # Create temporary directory for processing
    temp_dir = tempfile.mkdtemp()
    temp_input_path = None
    temp_svg_path = None
    temp_gcode_path = None

    try:
        # Save uploaded file
        filename = secure_filename(file.filename)
        temp_input_path = os.path.join(temp_dir, filename)
        file.save(temp_input_path)

        # Convert DXF to SVG if needed
        if file_type == 'dxf':
            temp_svg_path = os.path.join(temp_dir, filename.replace('.dxf', '.svg'))
            convert_dxf_to_svg(temp_input_path, temp_svg_path)
            svg_file_path = temp_svg_path
        else:
            svg_file_path = temp_input_path

        # Convert SVG to G-code
        params = CuttingParameters(
            material_thickness=5.0,  # For plotting, no Z depth
            cutting_speed=1000.0,
            movement_speed=3000.0,
            join_paths=True,
            knife_offset=0.0,  # No offset for pen plotting
            origin_top_left=True,
            mirror_y=True  # Mirror Y by default for correct orientation
        )

        gcode_tools = GCodeTools(params)
        temp_gcode_path = os.path.join(temp_dir, 'output.gcode')
        gcode = gcode_tools.svg_to_gcode(svg_file_path, temp_gcode_path)

        # Read the generated G-code
        with open(temp_gcode_path, 'r') as f:
            gcode_content = f.read()

        # Count lines
        line_count = len([line for line in gcode_content.split('\n') if line.strip() and not line.strip().startswith(';')])

        return jsonify({
            'success': True,
            'gcode': gcode_content,
            'line_count': line_count,
            'original_filename': filename
        })

    except Exception as e:
        print(f"Error in convert_to_gcode: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

    finally:
        # Clean up temporary files
        try:
            if temp_input_path and os.path.exists(temp_input_path):
                os.remove(temp_input_path)
            if temp_svg_path and os.path.exists(temp_svg_path):
                os.remove(temp_svg_path)
            if temp_gcode_path and os.path.exists(temp_gcode_path):
                os.remove(temp_gcode_path)
            if os.path.exists(temp_dir):
                # Remove any remaining files in temp dir
                for f in os.listdir(temp_dir):
                    try:
                        os.remove(os.path.join(temp_dir, f))
                    except:
                        pass
                os.rmdir(temp_dir)
        except Exception as e:
            print(f"Error cleaning up temporary files: {e}")

def start_server(host='0.0.0.0', port=5425, debug=False):
    try:
        socketio.run(app, host=host, port=port, debug=debug, use_reloader=False, allow_unsafe_werkzeug=True)
    except Exception as e:
        print(f"Error starting server: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    start_server(debug=True)
    start_server(debug=True)
