# AIquery Web Frontend

A modern chatbot interface for querying your data with natural language.

## Features

- 💬 Natural language questions about your data
- 📊 Interactive data visualizations
- 🔍 View SQL queries and JSON data
- 🎨 Dynamic chart generation with customizable styles
- 💡 Tip questions for common follow-up actions

## Getting Started

### Installation

```bash
# Install dependencies
cd web
pnpm install
```

### Development

Start the development server:

```bash
pnpm dev
```

The frontend will be available at `http://localhost:5173`

Make sure the backend is running on `http://localhost:3000`

### Build

To build for production:

```bash
pnpm build
```

The built files will be in the `dist` directory.

## Usage

1. Open `http://localhost:5173` in your browser
2. Type a natural language question about your data
3. View the response, JSON data, and options to:
   - Show SQL query
   - Generate charts
   - Change chart types

## API Endpoints

The frontend communicates with the backend via these endpoints:

- `POST /api/chat` - Send a question and get a response
- `POST /api/visualize` - Generate visualizations from data
- `GET /api/chart/:imagePath` - Serve chart images

## Features Explained

### Natural Language Input
Ask questions in plain English like:
- "What was the revenue last month?"
- "Show me the cost by channel"
- "How many leads did we get yesterday?"

### Conditional Rendering
The UI shows only what you request:
- **Response**: Always shown after a question
- **JSON Data**: Shown by default (click to expand)
- **SQL Query**: Shown only if you click "Show SQL Query"
- **Chart**: Shown only if you click "Show Chart"

### Tip Questions
After receiving a response, you can:
- "Show/Hide SQL Query" - View the SQL query that was executed
- "Show/Hide Chart" - Generate and display a chart
- "Make Bar Chart" - Change to a bar chart style
- "Make Pie Chart" - Change to a pie chart style

