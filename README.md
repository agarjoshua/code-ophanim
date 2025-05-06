# Django Visualizer for VS Code

An interactive VSCode extension that visualizes Django project structure as a connected graph of functions, classes, and URL patterns.

## Features

- **Interactive Graph Visualization**: See your Django project's structure as an interactive graph
- **Function & Class Navigation**: Click on any node to open the corresponding file
- **Relationship Mapping**: View connections between classes, methods, and URL patterns
- **Drag & Drop Layout**: Arrange nodes visually to understand relationships better

![Django Visualizer Screenshot](./media/screenshot.png)

## Requirements

- VS Code 1.60.0 or higher
- Python 3.6 or higher
- A Django project in your workspace

## Usage

1. Open a folder containing a Django project
2. Run the command `Django: Open Project Visualizer` from the Command Palette (Ctrl+Shift+P)
3. Click "Analyze Django Project" in the visualizer panel
4. Interact with the graph by:
   - Dragging nodes to arrange them
   - Clicking on nodes to navigate to source code
   - Zooming and panning with mouse/trackpad
   - Hovering over nodes for details

## How It Works

The extension:
1. Scans your Django project using Python's AST (Abstract Syntax Tree) analysis
2. Identifies functions, classes, methods, and URL patterns
3. Maps the relationships between these elements
4. Renders an interactive D3.js visualization in a VSCode webview panel

## Extension Settings

The extension doesn't require configuration, but future versions may include settings for:
- Graph layout algorithms
- Node color schemes
- File exclusion patterns

## Known Issues

- Large Django projects may have slow initial analysis
- Some complex URL routing patterns might not be correctly identified

## Development

### Building the Extension

```bash
# Clone this repository
git clone https://github.com/yourusername/django-visualizer.git

# Install dependencies
cd django-visualizer
npm install

# Compile the extension
npm run compile

# Package the extension
vsce package
```

### Structure

- `src/extension.ts`: Main extension code
- `media/`: Static assets
- Built using the VS Code Extension API and D3.js for visualization

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the [MIT License](LICENSE).