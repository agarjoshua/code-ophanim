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
            .node.app circle {
                fill: #ffffff;
                stroke: #666;
                opacity: 0.2;
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
            .link.app-link {
                stroke: #ccc;
                stroke-opacity: 0.3;
                stroke-dasharray: 2;
            }
            text {
                font-size: 12px;
                fill: var(--vscode-editor-foreground);
            }
            .app-text {
                font-size: 14px;
                font-weight: bold;
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
            <div class="legend-item">
                <div class="legend-color" style="background-color: #ffffff; border: 1px solid #666;"></div>
                <span>App</span>
            </div>
        </div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
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
                    
                    svg = d3.select('#graph')
                        .append('svg')
                        .attr('width', width)
                        .attr('height', height);
                    
                    zoom = d3.zoom()
                        .scaleExtent([0.1, 10])
                        .on('zoom', (event) => {
                            container.attr('transform', event.transform);
                        });
                    
                    svg.call(zoom);
                    const container = svg.append('g');
                    
                    window.addEventListener('resize', () => {
                        width = window.innerWidth;
                        height = window.innerHeight;
                        svg.attr('width', width).attr('height', height);
                        if (simulation) {
                            simulation.force('center', d3.forceCenter(width / 2, height / 2));
                            simulation.alpha(0.3).restart();
                        }
                    });
                    
                    analyzeBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'analyze' });
                    });
                    
                    resetBtn.addEventListener('click', () => {
                        svg.transition().duration(750).call(
                            zoom.transform,
                            d3.zoomIdentity
                        );
                        if (simulation) {
                            simulation.nodes().forEach(node => {
                                node.fx = null;
                                node.fy = null;
                            });
                            simulation.alpha(1).restart();
                        }
                    });
                    
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'updateGraph') {
                            updateGraph(message.data);
                        }
                    });
                    
                    function updateGraph(graphData) {
                        container.selectAll('*').remove();
                        
                        // Debug: Log node-to-app assignments
                        console.log('Nodes:', graphData.nodes.map(n => ({
                            id: n.id,
                            name: n.name,
                            app: n.app,
                            type: n.type
                        })));
                        
                        // Create app nodes and intra-app links
                        const nodesByApp = d3.group(graphData.nodes, d => d.app || 'unknown');
                        console.log('Nodes by App:', Array.from(nodesByApp.entries()).map(([app, nodes]) => ({
                            app,
                            nodeCount: nodes.length,
                            nodeNames: nodes.map(n => n.name)
                        })));
                        
                        const appNodes = Array.from(nodesByApp.keys()).map((app, i) => ({
                            id: \`app:\${app}\`,
                            name: app,
                            type: 'app',
                            x: (i % 3 - 1) * 400,
                            y: Math.floor(i / 3) * 400,
                            fx: (i % 3 - 1) * 400,
                            fy: Math.floor(i / 3) * 400 // Fix app nodes in place
                        }));
                        
                        // Combine app nodes with regular nodes
                        const allNodes = [...graphData.nodes, ...appNodes];
                        
                        // Create intra-app links (between nodes of the same app)
                        const intraAppLinks = [];
                        nodesByApp.forEach((nodes, app) => {
                            nodes.forEach((node, i) => {
                                // Link each node to its app node
                                intraAppLinks.push({
                                    source: node.id,
                                    target: \`app:\${app}\`,
                                    type: 'app-link'
                                });
                                // Link nodes within the same app (optional, limited to avoid clutter)
                                for (let j = i + 1; j < nodes.length && j < i + 3; j++) { // Limit to 2 links per node
                                    intraAppLinks.push({
                                        source: node.id,
                                        target: nodes[j].id,
                                        type: 'app-link'
                                    });
                                }
                            });
                        });
                        
                        // Combine all links
                        const allLinks = [...graphData.links, ...intraAppLinks];
                        
                        // Initialize node positions near their app node
                        allNodes.forEach(node => {
                            if (node.type !== 'app' && (!node.x || !node.y)) {
                                const appNode = appNodes.find(an => an.id === \`app:\${node.app || 'unknown'}\`);
                                if (appNode) {
                                    node.x = appNode.x + (Math.random() - 0.5) * 100;
                                    node.y = appNode.y + (Math.random() - 0.5) * 100;
                                }
                            }
                        });
                        
                        // Set up simulation
                        simulation = d3.forceSimulation()
                            .force('link', d3.forceLink().id(d => d.id).distance(d => d.type === 'app-link' ? 100 : 50))
                            .force('charge', d3.forceManyBody().strength(d => d.type === 'app' ? 0 : -1200)) // No repulsion for app nodes
                            .force('center', d3.forceCenter(width / 2, height / 2))
                            .force('collide', d3.forceCollide().radius(d => d.type === 'method' ? 15 : d.type === 'app' ? 30 : 20));
                        
                        link = container.append('g')
                            .selectAll('line')
                            .data(allLinks)
                            .enter().append('line')
                            .attr('class', d => \`link \${d.type}\`);
                        
                        node = container.append('g')
                            .selectAll('.node')
                            .data(allNodes)
                            .enter().append('g')
                            .attr('class', d => \`node \${d.type}\`)
                            .call(d3.drag()
                                .on('start', dragstarted)
                                .on('drag', dragged)
                                .on('end', dragended));
                        
                        node.append('circle')
                            .attr('r', d => d.type === 'method' ? 8 : d.type === 'app' ? 20 : 12);
                        
                        node.append('text')
                            .attr('dy', d => d.type === 'app' ? 5 : 22)
                            .attr('text-anchor', 'middle')
                            .attr('class', d => d.type === 'app' ? 'app-text' : '')
                            .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '...' : d.name);
                        
                        node.on('mouseover', function(event, d) {
                            if (d.type === 'app') return; // No tooltip for app nodes
                            const tooltipContent = \`
                                <div><strong>\${d.name}</strong></div>
                                <div>Type: \${d.type}</div>
                                <div>File: \${d.file || 'N/A'}</div>
                                <div>App: \${d.app || 'unknown'}</div>
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
                            if (d.type === 'app' || !d.file) return;
                            vscode.postMessage({
                                command: 'openFile',
                                file: d.file
                            });
                        });
                        
                        simulation
                            .nodes(allNodes)
                            .on('tick', ticked);
                        
                        simulation.force('link')
                            .links(allLinks);
                        
                        svg.call(zoom.transform, d3.zoomIdentity);
                        
                        function ticked() {
                            link
                                .attr('x1', d => d.source.x)
                                .attr('y1', d => d.source.y)
                                .attr('x2', d => d.target.x)
                                .attr('y2', d => d.target.y);
                            
                            node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
                        }
                        
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
                            d.fx = d.x;
                            d.fy = d.y;
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
    return ``
}