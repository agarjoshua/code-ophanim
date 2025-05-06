import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Define the interfaces for the node and link types
interface Node {
  id: string;
  name: string;
  type: string;
  file: string;
  app: string;
  parent?: string; // Optional property for methods
  view?: string;   // Optional property for URL nodes
}

interface Link {
  source: string;
  target: string | any; // Using 'string | any' for target since one error shows it can be 'any'
  type: string;
}

interface Graph {
  nodes: Node[];
  links: Link[];
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Django Visualizer extension is now active');

    // Command to open the Django visualizer panel
    let disposable = vscode.commands.registerCommand('django-visualizer.openVisualizer', () => {
        DjangoVisualizerPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(disposable);
}

class DjangoVisualizerPanel {
    public static currentPanel: DjangoVisualizerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (DjangoVisualizerPanel.currentPanel) {
            DjangoVisualizerPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'djangoVisualizer',
            'Django Project Visualizer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );

        DjangoVisualizerPanel.currentPanel = new DjangoVisualizerPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        console.log('1');
        this._panel = panel;

        // Set the webview's initial html content
        this._update(extensionUri);

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update(extensionUri);
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        console.log('2');
        this._panel.webview.onDidReceiveMessage(
            
            message => {
                switch (message.command) {
                    case 'analyze':
                        console.log('analyze has been called');
                        this._analyzeDjangoProject();
                        return;
                    case 'openFile':
                        this._openFile(message.file, message.line);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private _analyzeDjangoProject() {
        console.log('3');
        try {
            if (!vscode.workspace.workspaceFolders) {
                vscode.window.showErrorMessage('No workspace folder is open');
                return;
            }

            const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
            
            // Create a temporary file to store the Django script
            const scriptPath = path.join(workspacePath, 'django_structure_scanner.py');
            
            // Check if the user's script exists in the workspace
            const userScriptPath = path.join(workspacePath, 'paste.txt');
            if (fs.existsSync(userScriptPath)) {
                fs.copyFileSync(userScriptPath, scriptPath);
            } else {
                // Copy the embedded script to the workspace
                fs.writeFileSync(scriptPath, getDjangoScannerScript());
            }

            // Run the Python script
            vscode.window.showInformationMessage('Analyzing Django project structure...');
            execSync(`python ${scriptPath}`, { cwd: workspacePath });

            // Read the generated file
            const outputPath = path.join(workspacePath, 'django_project_structure.txt');
            const structureData = fs.readFileSync(outputPath, 'utf8');

            // Parse the data and convert to a graph structure
            const graphData = this._parseStructureToGraph(structureData, workspacePath);

            // Send the data to the webview
            this._panel.webview.postMessage({ 
                command: 'updateGraph', 
                data: graphData 
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error analyzing Django project: ${error}`);
        }
    }

    private _parseStructureToGraph(structureData: string, workspacePath: string): Graph {
        // Initialize graph data structure with proper typing
        const graph: Graph = {
            nodes: [],
            links: []
        };

        const lines = structureData.split('\n');
        let currentApp = '';
        let currentFile = '';
        let currentClass = '';
        
        // Parse the structure file line by line
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Parse Django App
            if (line.startsWith('🌐 Django App:')) {
                currentApp = line.replace('🌐 Django App:', '').trim();
                continue;
            }
            
            // Parse File
            if (line.startsWith('📂')) {
                currentFile = line.replace('📂', '').trim();
                continue;
            }
            
            // Parse Class
            if (line.startsWith('🏛️')) {
                currentClass = line.replace('🏛️', '').trim();
                // Add class node
                graph.nodes.push({
                    id: `${currentApp}:${currentFile}:${currentClass}`,
                    name: currentClass,
                    type: 'class',
                    file: currentFile,
                    app: currentApp
                });
                continue;
            }
            
            // Parse Function/Method
            if (line.includes('🏷️')) {
                let functionName = line.replace('🏷️', '').replace('()', '').trim();
                
                // Check if it's a method or top-level function
                if (line.startsWith('  └─')) {
                    // This is a method
                    functionName = functionName.replace('└─', '').trim();
                    // Add method node
                    const methodId = `${currentApp}:${currentFile}:${currentClass}.${functionName}`;
                    graph.nodes.push({
                        id: methodId,
                        name: functionName,
                        type: 'method',
                        file: currentFile,
                        app: currentApp,
                        parent: currentClass
                    });
                    
                    // Add link from class to method
                    graph.links.push({
                        source: `${currentApp}:${currentFile}:${currentClass}`,
                        target: methodId,
                        type: 'contains'
                    });
                } else {
                    // This is a top-level function
                    // Add function node
                    graph.nodes.push({
                        id: `${currentApp}:${currentFile}:${functionName}`,
                        name: functionName,
                        type: 'function',
                        file: currentFile,
                        app: currentApp
                    });
                }
                continue;
            }
            
            // Parse URL Pattern
            if (line.includes('🌐 URL Pattern:')) {
                const parts = line.replace('🌐 URL Pattern:', '').split('->');
                if (parts.length === 2) {
                    const pattern = parts[0].trim();
                    const view = parts[1].trim();
                    
                    // Add URL node
                    const urlId = `${currentApp}:${currentFile}:url:${pattern}`;
                    graph.nodes.push({
                        id: urlId,
                        name: `URL: ${pattern}`,
                        type: 'url',
                        file: currentFile,
                        app: currentApp,
                        view: view
                    });
                    
                    // Try to find the view function/class node and link to it
                    const viewName = view.split('.').pop() || '';
                    const potentialTargets = graph.nodes.filter(n => 
                        n.name === viewName && (n.type === 'function' || n.type === 'class')
                    );
                    
                    if (potentialTargets.length > 0) {
                        graph.links.push({
                            source: urlId,
                            target: potentialTargets[0].id,
                            type: 'routes-to'
                        });
                    }
                }
            }
        }
        
        return graph;
    }

    private _openFile(filePath: string, line: number = 0) {
        if (!vscode.workspace.workspaceFolders) {
            return;
        }
        
        const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const fullPath = path.join(workspacePath, filePath);
        
        vscode.workspace.openTextDocument(fullPath).then(document => {
            vscode.window.showTextDocument(document).then(editor => {
                // Move cursor to the specified line
                if (line > 0) {
                    const position = new vscode.Position(line - 1, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(
                        new vscode.Range(position, position),
                        vscode.TextEditorRevealType.InCenter
                    );
                }
            });
        });
    }

    private _update(extensionUri: vscode.Uri) {
        this._panel.title = 'Django Project Visualizer';
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
    }

    

    private _getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
        
        return `
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Django Project Visualizer</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-font-family);
                }
                
                #controls {
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    z-index: 10;
                }
                
                #graph {
                    width: 100vw;
                    height: 100vh;
                }
                
                .node {
                    cursor: pointer;
                }
                
                .node circle {
                    stroke-width: 2px;
                }
                
                .node.class circle {
                    fill: #6baed6;
                    stroke: #3182bd;
                }
                
                .node.function circle {
                    fill: #74c476;
                    stroke: #31a354;
                }
                
                .node.method circle {
                    fill: #9ecae1;
                    stroke: #6baed6;
                }
                
                .node.url circle {
                    fill: #fd8d3c;
                    stroke: #e6550d;
                }
                
                .link {
                    stroke: #999;
                    stroke-opacity: 0.6;
                }
                
                .link.routes-to {
                    stroke: #e6550d;
                    stroke-width: 2px;
                }
                
                .link.contains {
                    stroke-dasharray: 5;
                }
                
                text {
                    font-size: 12px;
                    fill: var(--vscode-editor-foreground);
                }
                
                .tooltip {
                    position: absolute;
                    padding: 8px;
                    background-color: var(--vscode-editor-widget-background);
                    color: var(--vscode-editor-foreground);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    pointer-events: none;
                    opacity: 0;
                }
                
                #legend {
                    position: absolute;
                    bottom: 20px;
                    right: 20px;
                    background-color: var(--vscode-editor-widget-background);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    padding: 10px;
                }
                
                .legend-item {
                    display: flex;
                    align-items: center;
                    margin-bottom: 5px;
                }
                
                .legend-color {
                    width: 15px;
                    height: 15px;
                    border-radius: 50%;
                    margin-right: 5px;
                }
            </style>
        </head>
        <body>
            <div id="controls">
                <button id="analyze-btn">Analyze Django Project</button>
                <button id="reset-btn">Reset View</button>
            </div>
            
            <div id="graph"></div>
            <div class="tooltip"></div>
            
            <div id="legend">
                <h3>Legend</h3>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #6baed6;"></div>
                    <span>Class</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #74c476;"></div>
                    <span>Function</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #9ecae1;"></div>
                    <span>Method</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background-color: #fd8d3c;"></div>
                    <span>URL Pattern</span>
                </div>
            </div>
            
            <script>
                (function() {
                    // Get the vscode API
                    const vscode = acquireVsCodeApi();

                    console.log('so the vscode api is called'+vscode)
                    // D3.js script (v7)
                    
                    // const d3Script = document.createElement('script');
                    // d3Script.src = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js')).toString();
                    // d3Script.onload = initializeApp;
                    // document.head.appendChild(d3Script);
                    // d3Script.onerror = () => console.error('Failed to load D3 script');
                    const d3Script = document.createElement('script');
                    d3Script.src = '${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js'))}';
                    d3Script.onload = initializeApp;
                    d3Script.onerror = () => console.error('Failed to load D3 script');
                    document.head.appendChild(d3Script);
                    
                    function initializeApp() {
                        const analyzeBtn = document.getElementById('analyze-btn');
                        const resetBtn = document.getElementById('reset-btn');
                        const graphDiv = document.getElementById('graph');
                        const tooltip = document.querySelector('.tooltip');
                        
                        let svg, simulation, link, node, zoom;
                        let width = window.innerWidth;
                        let height = window.innerHeight;
                        
                        // Create SVG container
                        svg = d3.select('#graph')
                            .append('svg')
                            .attr('width', width)
                            .attr('height', height);
                        
                        // Add zoom functionality
                        zoom = d3.zoom()
                            .scaleExtent([0.1, 10])
                            .on('zoom', (event) => {
                                container.attr('transform', event.transform);
                            });
                        
                        svg.call(zoom);
                        
                        // Create a container for all elements that will be zoomed
                        const container = svg.append('g');
                        
                        // Handle window resize
                        window.addEventListener('resize', () => {
                            width = window.innerWidth;
                            height = window.innerHeight;
                            svg.attr('width', width).attr('height', height);
                            if (simulation) {
                                simulation.force('center', d3.forceCenter(width / 2, height / 2));
                                simulation.alpha(0.3).restart();
                            }
                        });
                        
                        // Button click handlers
                        analyzeBtn.addEventListener('click', () => {
                            console.log('so the vscode api is called'+vscode)
                            vscode.postMessage({ command: 'analyze' });

                            console.log('so the vscode api is called');
                        });
                        
                        resetBtn.addEventListener('click', () => {
                            svg.transition().duration(750).call(
                                zoom.transform,
                                d3.zoomIdentity
                            );
                        });
                        
                        // Listen for messages from the extension
                        window.addEventListener('message', event => {
                            const message = event.data;
                            
                            switch (message.command) {
                                case 'updateGraph':
                                    updateGraph(message.data);
                                    break;
                            }
                        });
                        
                        // Function to update the graph with new data
                        function updateGraph(graphData) {
                            // Clear existing graph
                            container.selectAll('*').remove();
                            
                            // Create the simulation
                            simulation = d3.forceSimulation()
                                .force('link', d3.forceLink().id(d => d.id).distance(150))
                                .force('charge', d3.forceManyBody().strength(-500))
                                .force('center', d3.forceCenter(width / 2, height / 2))
                                .force('collide', d3.forceCollide().radius(60));
                            
                            // Create links
                            link = container.append('g')
                                .selectAll('line')
                                .data(graphData.links)
                                .enter().append('line')
                                .attr('class', d => \`link \${d.type}\`);
                            
                            // Create node groups
                            node = container.append('g')
                                .selectAll('.node')
                                .data(graphData.nodes)
                                .enter().append('g')
                                .attr('class', d => \`node \${d.type}\`)
                                .call(d3.drag()
                                    .on('start', dragstarted)
                                    .on('drag', dragged)
                                    .on('end', dragended));
                            
                            // Add circles to nodes
                            node.append('circle')
                                .attr('r', d => d.type === 'method' ? 8 : 12);
                            
                            // Add labels to nodes
                            node.append('text')
                                .attr('dy', 22)
                                .attr('text-anchor', 'middle')
                                .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
                            
                            // Node interactions
                            node.on('mouseover', function(event, d) {
                                const tooltipContent = \`
                                    <div><strong>\${d.name}</strong></div>
                                    <div>Type: \${d.type}</div>
                                    <div>File: \${d.file}</div>
                                    <div>App: \${d.app}</div>
                                    \${d.view ? \`<div>Routes to: \${d.view}</div>\` : ''}
                                    \${d.parent ? \`<div>Class: \${d.parent}</div>\` : ''}
                                    <div class="tooltip-hint">(Click to open file)</div>
                                \`;
                                
                                tooltip.style.left = \`\${event.pageX + 10}px\`;
                                tooltip.style.top = \`\${event.pageY + 10}px\`;
                                tooltip.style.opacity = 1;
                                tooltip.innerHTML = tooltipContent;
                            })
                            .on('mouseout', function() {
                                tooltip.style.opacity = 0;
                            })
                            .on('click', function(event, d) {
                                vscode.postMessage({
                                    command: 'openFile',
                                    file: d.file
                                });
                            });
                            
                            // Update the simulation
                            simulation
                                .nodes(graphData.nodes)
                                .on('tick', ticked);
                            
                            simulation.force('link')
                                .links(graphData.links);
                            
                            // Center the view
                            svg.call(zoom.transform, d3.zoomIdentity);
                            
                            // Tick function for the simulation
                            function ticked() {
                                link
                                    .attr('x1', d => d.source.x)
                                    .attr('y1', d => d.source.y)
                                    .attr('x2', d => d.target.x)
                                    .attr('y2', d => d.target.y);
                                
                                node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
                            }
                            
                            // Drag functions
                            function dragstarted(event, d) {
                                if (!event.active) simulation.alphaTarget(0.3).restart();
                                d.fx = d.x;
                                d.fy = d.y;
                            }
                            
                            function dragged(event, d) {
                                d.fx = event.x;
                                d.fy = event.y;
                            }
                            
                            function dragended(event, d) {
                                if (!event.active) simulation.alphaTarget(0);
                                // Keep nodes in place after drag
                                // If you want nodes to return to simulation, uncomment:
                                // d.fx = null;
                                // d.fy = null;
                            }
                        }
                    }
                })();
            </script>
        </body>
        </html>`;
    }

    public dispose() {
        DjangoVisualizerPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

// Helper function to get the Django scanner script
function getDjangoScannerScript(): string {
    // This is the content of your original Python script
    return `import ast
from pathlib import Path
import os
import sys
from datetime import datetime


def parse_code(file_path):
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())
        return tree
    except (SyntaxError, UnicodeDecodeError) as e:
        return None


def extract_functions_classes(tree):
    if tree is None:
        return []
        
    nodes = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            nodes.append({
                "type": "Function" if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else "Class",
                "name": node.name,
                "methods": [n.name for n in ast.walk(node)
                           if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                           and n != node] if isinstance(node, ast.ClassDef) else []
            })
        # Extract urlpatterns
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "urlpatterns":
                    url_patterns = []
                    # Check if the value is a List or a BinOp (e.g., urlpatterns = [...] + [...])
                    if isinstance(node.value, ast.List):
                        url_list = node.value
                    elif isinstance(node.value, ast.BinOp) and isinstance(node.value.op, ast.Add):
                        # Handle cases like urlpatterns = [...] + [...]
                        url_list = node.value.left if isinstance(node.value.left, ast.List) else node.value.right
                    else:
                        continue
                    
                    # Extract path() or url() calls from the list
                    for elt in url_list.elts:
                        if isinstance(elt, ast.Call):
                            func_name = elt.func.attr if isinstance(elt.func, ast.Attribute) else elt.func.id
                            if func_name in ('path', 'url'):
                                # Extract the first argument (the URL pattern)
                                if elt.args and isinstance(elt.args[0], ast.Constant):
                                    url_pattern = elt.args[0].value
                                    url_patterns.append(url_pattern)
                    
                    if url_patterns:
                        nodes.append({
                            "type": "URLPatterns",
                            "name": "urlpatterns",
                            "patterns": url_patterns
                        })
    return nodes


def extract_urls(tree):
    if tree is None:
        return []
        
    urls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and \\
           len(node.targets) == 1 and \\
           isinstance(node.targets[0], ast.Name) and \\
           node.targets[0].id == 'urlpatterns' and \\
           isinstance(node.value, ast.List):
            
            for element in node.value.elts:
                if isinstance(element, ast.Call) and \\
                   isinstance(element.func, ast.Name) and \\
                   element.func.id in ('path', 're_path') and \\
                   len(element.args) >= 2:
                    
                    url_pattern = None
                    view_name = None
                    
                    # Get URL pattern (first argument)
                    if isinstance(element.args[0], (ast.Constant, ast.Constant)):
                        url_pattern = element.args[0].value if hasattr(element.args[0], 's') else element.args[0].value
                    
                    # Get view (second argument)
                    if isinstance(element.args[1], ast.Name):
                        view_name = element.args[1].id
                    elif isinstance(element.args[1], ast.Call):
                        # Handle cases like view.MyView.as_view()
                        if isinstance(element.args[1].func, ast.Attribute) and element.args[1].func.attr == 'as_view':
                            # This is a class-based view with as_view()
                            parts = []
                            current = element.args[1].func.value
                            while isinstance(current, ast.Attribute):
                                parts.append(current.attr)
                                current = current.value
                            if isinstance(current, ast.Name):
                                parts.append(current.id)
                            view_name = '.'.join(reversed(parts))
                        else:
                            view_name = str(element.args[1])  # Fallback
                    elif isinstance(element.args[1], ast.Attribute):
                        parts = []
                        current = element.args[1]
                        while isinstance(current, ast.Attribute):
                            parts.append(current.attr)
                            current = current.value
                        if isinstance(current, ast.Name):
                            parts.append(current.id)
                        view_name = '.'.join(reversed(parts))
                    elif isinstance(element.args[1], (ast.Str, ast.Constant)):
                        view_name = element.args[1].s if hasattr(element.args[1], 's') else element.args[1].value
                    
                    if url_pattern and view_name:
                        urls.append({
                            "type": "URL Pattern",
                            "pattern": url_pattern,
                            "view": view_name,
                            "decorators": [d.id for d in element.keywords 
                                         if isinstance(d, ast.keyword) and 
                                         isinstance(d.value, ast.Name)]
                        })
    return urls

def find_django_apps():
    """Find all Django apps in the current directory structure."""
    django_apps = []
    
    # Add the current directory to check for settings.py
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


def generate_tree_file(app_paths, output_file="django_project_structure.txt"):
    """Generate and write tree structure for multiple Django apps to a file."""
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(f"🌟 Django Project Structure - Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\\n")
        f.write("=" * 80 + "\\n\\n")
		
        if not app_paths:
            f.write("❌ No Django apps found!\\n")
            print(f"No Django apps found! Output saved to {output_file}")
            return
            
        f.write(f"🌲 Found {len(app_paths)} Django apps\\n")
        print(f"Found {len(app_paths)} Django apps. Scanning...")
        
        for app_path in app_paths:
            app_name = app_path.name
            f.write(f"\\n\\n🌐 Django App: {app_name}\\n")
            f.write("-" * 80 + "\\n")
            
            py_files = list(app_path.rglob("*.py"))
            if not py_files:
                f.write(f"  ⚠️ No Python files found in {app_name}\\n")
                continue
                
            for py_file in py_files:
                # Skip migration files to reduce clutter
                if "migrations" in str(py_file) and py_file.name != "__init__.py":
                    continue
                    
                relative_path = py_file.relative_to(Path('.'))
                f.write(f"\\n📂 {relative_path}\\n")
                
                tree = parse_code(py_file)
                items = extract_functions_classes(tree)
                urls = extract_urls(tree)
                
                if not items and not urls:
                    f.write(f"  📝 No classes or functions found\\n")
                    continue
                    
                for item in items:
                    if item["type"] == "Class":
                        f.write(f"  🏛️ {item['name']}\\n")
                        for method in item["methods"]:
                            f.write(f"    └─ 🏷️ {method}()\\n")
                    else:
                        f.write(f"  🏷️ {item['name']}()\\n")

                for url in urls:
                    if url["type"] == "URL Pattern":
                        f.write(f"  🌐 URL Pattern: {url['pattern']} -> {url['view']}\\n")
                        if url["decorators"]:
                            f.write(f"    Decorators: {', '.join(url['decorators'])}\\n")

    print(f"Scan complete! Results saved to {output_file}")


if __name__ == "__main__":
    print('🚀 Django Project Structure Scanner - File Output')
    apps = find_django_apps()
    
    # You can specify a custom output file name here
    output_filename = "django_project_structure.txt"
    generate_tree_file(apps, output_filename)`
}