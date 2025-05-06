import ast
from pathlib import Path
import json
import os
from datetime import datetime


def parse_code(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            source = f.read()
            tree = ast.parse(source)
        return tree, source
    except (SyntaxError, UnicodeDecodeError) as e:
        return None, None


def get_node_line_numbers(node, source_lines):
    """Get line number information for a node."""
    line_start = node.lineno
    try:
        line_end = node.end_lineno if hasattr(node, 'end_lineno') else node.lineno
        col_start = node.col_offset if hasattr(node, 'col_offset') else 0
        col_end = node.end_col_offset if hasattr(node, 'end_col_offset') else len(source_lines[line_end-1])
    except (AttributeError, IndexError):
        line_end = line_start
        col_start = 0
        col_end = 0
    
    return {
        "line_start": line_start,
        "line_end": line_end,
        "col_start": col_start,
        "col_end": col_end
    }


def extract_functions_classes(tree, source):
    if tree is None:
        return []
    
    source_lines = source.split('\n') if source else []
    nodes = []
    
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            location = get_node_line_numbers(node, source_lines)
            
            if isinstance(node, ast.ClassDef):
                methods = []
                for child_node in ast.walk(node):
                    if isinstance(child_node, (ast.FunctionDef, ast.AsyncFunctionDef)) and child_node != node:
                        method_location = get_node_line_numbers(child_node, source_lines)
                        methods.append({
                            "name": child_node.name,
                            "is_async": isinstance(child_node, ast.AsyncFunctionDef),
                            "location": method_location
                        })
                
                nodes.append({
                    "type": "Class",
                    "name": node.name,
                    "location": location,
                    "methods": methods
                })
            else:
                nodes.append({
                    "type": "Function",
                    "name": node.name,
                    "is_async": isinstance(node, ast.AsyncFunctionDef),
                    "location": location,
                    "methods": []
                })
                
    return nodes


def find_django_apps():
    """Find all Django apps in the current directory structure."""
    django_apps = []
    current_dir = Path('.')
    
    # Look for settings.py to find the project root
    settings_files = list(current_dir.rglob("settings.py"))
    if not settings_files:
        print("⚠️ Could not find settings.py. Make sure you're running this from the Django project root.")
        return []
    
    # Check all directories for apps (look for apps.py which is standard in Django apps)
    for app_config in current_dir.rglob("apps.py"):
        app_dir = app_config.parent
        django_apps.append(app_dir)
        
    # If we didn't find any apps with apps.py, fall back to a simpler approach
    if not django_apps:
        for dir_path in current_dir.iterdir():
            if dir_path.is_dir() and not dir_path.name.startswith('.') and not dir_path.name.startswith('__'):
                # Check if directory contains Python files
                has_py_files = any(file.suffix == '.py' for file in dir_path.iterdir() if file.is_file())
                if has_py_files:
                    django_apps.append(dir_path)
    
    return django_apps


def find_imports_and_relations(tree, source, file_path):
    """Extract imports and try to establish relations between files."""
    if tree is None:
        return []
    
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.Import):
                for name in node.names:
                    imports.append({
                        "type": "import",
                        "module": name.name,
                        "name": name.asname or name.name
                    })
            else:  # ImportFrom
                module = node.module or ""
                for name in node.names:
                    imports.append({
                        "type": "importfrom",
                        "module": module,
                        "name": name.name,
                        "asname": name.asname
                    })
    
    return imports


def generate_project_structure_json(app_paths, output_file="django_project_structure.json"):
    """Generate project structure in JSON format with file paths and line numbers."""
    project_data = {
        "generated_at": datetime.now().isoformat(),
        "apps": []
    }
    
    if not app_paths:
        print("No Django apps found!")
        return
    
    print(f"Found {len(app_paths)} Django apps. Scanning...")
    
    for app_path in app_paths:
        app_name = app_path.name
        app_data = {
            "name": app_name,
            "path": str(app_path),
            "files": []
        }
        
        py_files = list(app_path.rglob("*.py"))
        for py_file in py_files:
            # Skip migration files to reduce clutter
            if "migrations" in str(py_file) and py_file.name != "__init__.py":
                continue
            
            relative_path = str(py_file.relative_to(Path('.')))
            absolute_path = str(py_file.resolve())
            
            tree, source = parse_code(py_file)
            items = extract_functions_classes(tree, source)
            imports = find_imports_and_relations(tree, source, py_file)
            
            file_data = {
                "name": py_file.name,
                "relative_path": relative_path,
                "absolute_path": absolute_path,
                "items": items,
                "imports": imports
            }
            
            app_data["files"].append(file_data)
        
        project_data["apps"].append(app_data)
    
    # Save JSON output
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(project_data, f, indent=2)
    
    print(f"Scan complete! JSON data saved to {output_file}")
    return project_data


if __name__ == "__main__":
    print('Django Project Structure Scanner - JSON Output')
    apps = find_django_apps()
    
    # You can specify a custom output file name here
    output_filename = "django_project_structure.json"
    generate_project_structure_json(apps, output_filename)