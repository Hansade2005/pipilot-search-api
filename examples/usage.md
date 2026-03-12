# Usage Examples - PiPilot Search API

Complete examples in multiple languages and frameworks.

---

## TypeScript / JavaScript

### Basic Search

```typescript
// Using fetch (works in Node.js 18+, Deno, Bun, browsers)
const API_KEY = 'your-api-key';
const BASE_URL = 'https://api.pipilot.dev';

async function search(query: string) {
  const response = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      maxResults: 10,
      rerank: true
    })
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  return await response.json();
}

// Usage
const results = await search('AI frameworks 2025');
console.log(results.results[0].title);
console.log('Processing time:', results.processingTime);
console.log('Cached:', results.cached);
```

### Using the SDK

```typescript
import PiPilot from '@pipilot/search-api';

const client = new PiPilot(process.env.PIPILOT_API_KEY!);

// Search
const results = await client.search({
  query: 'AI frameworks 2025',
  maxResults: 10,
  rerank: true
});

console.log(results.results);

// Extract
const content = await client.extract('https://example.com/article');
console.log(content.content);

// Smart Search
const answer = await client.smartSearch({
  query: 'What are the latest quantum computing breakthroughs?',
  depth: 'deep',
  maxIterations: 5
});

console.log('Answer:', answer.answer);
console.log('Sources:', answer.sources);
console.log('Took', answer.iterations, 'iterations');
```

---

## Python

### Using requests

```python
import requests
import os

API_KEY = os.getenv('PIPILOT_API_KEY')
BASE_URL = 'https://api.pipilot.dev'

def search(query: str, rerank: bool = True):
    """Search the web with PiPilot"""
    response = requests.post(
        f'{BASE_URL}/search',
        headers={'Authorization': f'Bearer {API_KEY}'},
        json={
            'query': query,
            'maxResults': 10,
            'rerank': rerank
        }
    )
    response.raise_for_status()
    return response.json()

def extract(url: str, format: str = 'markdown'):
    """Extract content from URL"""
    response = requests.post(
        f'{BASE_URL}/extract',
        headers={'Authorization': f'Bearer {API_KEY}'},
        json={'url': url, 'format': format}
    )
    response.raise_for_status()
    return response.json()

def smart_search(query: str, max_iterations: int = 3):
    """Smart search with iterative research"""
    response = requests.post(
        f'{BASE_URL}/smart-search',
        headers={'Authorization': f'Bearer {API_KEY}'},
        json={
            'query': query,
            'maxIterations': max_iterations
        }
    )
    response.raise_for_status()
    return response.json()

# Usage
if __name__ == '__main__':
    # Search
    results = search('AI frameworks 2025')
    print(results['results'][0]['title'])
    print(f"Found {results['count']} results in {results['processingTime']}")

    # Extract
    content = extract('https://example.com/article')
    print(f"Extracted {content['wordCount']} words")

    # Smart search
    answer = smart_search('What are the latest AI trends?')
    print('Answer:', answer['answer'])
    print('Sources:', len(answer['sources']))
```

### PiPilot Client Class

```python
class PiPilotClient:
    def __init__(self, api_key: str, base_url: str = 'https://api.pipilot.dev'):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({'Authorization': f'Bearer {api_key}'})

    def search(self, query: str, max_results: int = 10, rerank: bool = True):
        response = self.session.post(
            f'{self.base_url}/search',
            json={'query': query, 'maxResults': max_results, 'rerank': rerank}
        )
        response.raise_for_status()
        return response.json()

    def extract(self, url: str, format: str = 'markdown'):
        response = self.session.post(
            f'{self.base_url}/extract',
            json={'url': url, 'format': format}
        )
        response.raise_for_status()
        return response.json()

    def smart_search(self, query: str, depth: str = 'normal', max_iterations: int = 3):
        response = self.session.post(
            f'{self.base_url}/smart-search',
            json={'query': query, 'depth': depth, 'maxIterations': max_iterations}
        )
        response.raise_for_status()
        return response.json()

# Usage
client = PiPilotClient(os.getenv('PIPILOT_API_KEY'))
results = client.search('AI frameworks 2025')
print(results['results'][0])
```

---

## Next.js

### API Route

```typescript
// app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import PiPilot from '@pipilot/search-api';

const client = new PiPilot(process.env.PIPILOT_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json(
        { error: 'Missing query parameter' },
        { status: 400 }
      );
    }

    const results = await client.search(query);

    return NextResponse.json(results);

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### Client Component

```typescript
'use client';

import { useState } from 'react';

export default function SearchComponent() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);

    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    setResults(data.results || []);
    setLoading(false);
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? 'Searching...' : 'Search'}
      </button>

      <div>
        {results.map((result, i) => (
          <div key={i}>
            <h3>{result.title}</h3>
            <p>{result.snippet}</p>
            <a href={result.url}>{result.url}</a>
            {result.score && <span>Score: {result.score.toFixed(2)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## LangChain Integration

### TypeScript

```typescript
import { Tool } from 'langchain/tools';
import PiPilot from '@pipilot/search-api';

const client = new PiPilot(process.env.PIPILOT_API_KEY!);

// Search tool
export const pipilotSearchTool = new Tool({
  name: 'pipilot_search',
  description: 'Search the web for current information. Input should be a search query string.',
  func: async (query: string) => {
    const results = await client.search(query);
    return JSON.stringify(results.results.slice(0, 5));
  }
});

// Extract tool
export const pipilotExtractTool = new Tool({
  name: 'pipilot_extract',
  description: 'Extract clean content from a URL. Input should be a valid URL.',
  func: async (url: string) => {
    const content = await client.extract(url);
    return content.content.slice(0, 4000);
  }
});

// Usage with agent
import { OpenAI } from 'langchain/llms/openai';
import { initializeAgentExecutorWithOptions } from 'langchain/agents';

const model = new OpenAI({ temperature: 0 });

const executor = await initializeAgentExecutorWithOptions(
  [pipilotSearchTool, pipilotExtractTool],
  model,
  { agentType: 'zero-shot-react-description' }
);

const result = await executor.call({
  input: 'What are the latest AI frameworks in 2025?'
});

console.log(result.output);
```

### Python

```python
from langchain.tools import Tool
from langchain.agents import initialize_agent, AgentType
from langchain.llms import OpenAI
import requests
import os

API_KEY = os.getenv('PIPILOT_API_KEY')

def pipilot_search(query: str) -> str:
    """Search the web using PiPilot"""
    response = requests.post(
        'https://api.pipilot.dev/search',
        headers={'Authorization': f'Bearer {API_KEY}'},
        json={'query': query, 'maxResults': 5}
    )
    results = response.json()['results']
    return '\n'.join([f"{r['title']}: {r['snippet']}" for r in results])

def pipilot_extract(url: str) -> str:
    """Extract content from URL"""
    response = requests.post(
        'https://api.pipilot.dev/extract',
        headers={'Authorization': f'Bearer {API_KEY}'},
        json={'url': url}
    )
    return response.json()['content'][:4000]

tools = [
    Tool(
        name='PiPilot Search',
        func=pipilot_search,
        description='Search the web for current information'
    ),
    Tool(
        name='PiPilot Extract',
        func=pipilot_extract,
        description='Extract clean content from a URL'
    )
]

llm = OpenAI(temperature=0)
agent = initialize_agent(tools, llm, agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION)

result = agent.run('What are the latest AI frameworks in 2025?')
print(result)
```

---

## cURL Examples

### Basic Search

```bash
curl -X POST https://api.pipilot.dev/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AI frameworks 2025",
    "maxResults": 10,
    "rerank": true
  }'
```

### Extract Content

```bash
curl -X POST https://api.pipilot.dev/extract \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "format": "markdown"
  }'
```

### Smart Search

```bash
curl -X POST https://api.pipilot.dev/smart-search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the latest quantum computing breakthroughs?",
    "depth": "deep",
    "maxIterations": 5
  }'
```

### With jq for Pretty Output

```bash
curl -X POST https://api.pipilot.dev/search \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"query":"AI frameworks 2025"}' \
  | jq '.results[] | {title, url, score}'
```

---

## React Native / Expo

```typescript
import { useState } from 'react';
import { View, TextInput, Button, FlatList, Text } from 'react-native';

const API_KEY = 'your-api-key';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const search = async () => {
    const response = await fetch('https://api.pipilot.dev/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, rerank: true })
    });

    const data = await response.json();
    setResults(data.results);
  };

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search..."
      />
      <Button title="Search" onPress={search} />

      <FlatList
        data={results}
        renderItem={({ item }) => (
          <View>
            <Text style={{ fontWeight: 'bold' }}>{item.title}</Text>
            <Text>{item.snippet}</Text>
            <Text>{item.url}</Text>
          </View>
        )}
      />
    </View>
  );
}
```

---

## Error Handling

### TypeScript

```typescript
import PiPilot, { PiPilotError } from '@pipilot/search-api';

const client = new PiPilot(process.env.PIPILOT_API_KEY!);

try {
  const results = await client.search('AI frameworks');
  console.log(results);

} catch (error) {
  if (error instanceof PiPilotError) {
    if (error.statusCode === 401) {
      console.error('Invalid API key');
    } else if (error.statusCode === 429) {
      console.error('Rate limit exceeded:', error.details);
    } else {
      console.error('API error:', error.message);
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Python

```python
try:
    results = client.search('AI frameworks')
    print(results)

except requests.exceptions.HTTPError as e:
    if e.response.status_code == 401:
        print('Invalid API key')
    elif e.response.status_code == 429:
        print('Rate limit exceeded')
    else:
        print(f'API error: {e}')

except Exception as e:
    print(f'Unexpected error: {e}')
```

---

## Streaming Responses (Future)

```typescript
// Future feature: streaming smart search
const stream = await client.smartSearchStream({
  query: 'What are the latest AI trends?'
});

for await (const chunk of stream) {
  if (chunk.type === 'tool_start') {
    console.log(`Using tool: ${chunk.tool}`);
  } else if (chunk.type === 'content') {
    console.log(chunk.content);
  } else if (chunk.type === 'done') {
    console.log('Final answer:', chunk.answer);
  }
}
```

---

## Best Practices

### 1. Use Environment Variables

```bash
# .env
PIPILOT_API_KEY=your-api-key-here
```

```typescript
import dotenv from 'dotenv';
dotenv.config();

const client = new PiPilot(process.env.PIPILOT_API_KEY!);
```

### 2. Implement Caching

```typescript
const cache = new Map();

async function cachedSearch(query: string) {
  if (cache.has(query)) {
    return cache.get(query);
  }

  const results = await client.search(query);
  cache.set(query, results);

  // Cache for 1 hour
  setTimeout(() => cache.delete(query), 3600000);

  return results;
}
```

### 3. Retry Logic

```typescript
async function searchWithRetry(query: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.search(query);
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;

      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 2 ** i * 1000));
    }
  }
}
```

---

Made with ❤️ by Hans Ade @ Pixelways Solutions Inc
