// Mock OpenAI-compatible server để verify luồng fix-preview không cần API key thật
const http = require('node:http');

const fixedApp = `import { useEffect, useRef, useState } from 'react';
// FIX: import từng hàm lodash thay vì nguyên khối
import debounce from 'lodash/debounce';
// FIX: thay moment bằng Intl API nội tuyến
import { LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts';
import { BigButton } from './components';

function LeakyCounter() {
  const [n, setN] = useState(0);
  const leaked = useRef([]);

  useEffect(() => {
    // FIX: thêm mảng deps [] — effect chỉ chạy 1 lần khi mount
    const timer = setInterval(() => setN((v) => Math.min(v + 1, 400)), 250);
    const onResize = () => setN((v) => v);
    window.addEventListener('resize', onResize);
    for (let i = 0; i < 25; i++) {
      const detached = document.createElement('div');
      detached.innerHTML = \`<span>leak-\${n}-\${i}</span>\`;
      leaked.current.push(detached);
    }
    return () => {
      clearInterval(timer);
      // FIX: gỡ listener khi unmount
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <p>
      Số lần render: <strong data-testid="counter">{n}</strong> (đang leak {leaked.current.length} node)
    </p>
  );
}

function SlowText({ value }) {
  // FIX: chỉ sort lại khi value đổi, không tính toán mỗi render
  const items = useMemo(() => {
    return Array.from({ length: 3000 }, (_, i) => (i * 7 + value.length) % 997).sort((a, b) => a - b);
  }, [value]);
  return (
    <p>
      {new Intl.DateTimeFormat('vi', { year: 'numeric' }).format(new Date())} — {items.length} items sorted, value.length={value.length}
    </p>
  );
}

export default function App() {
  const [text, setText] = useState('');

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Leaky Demo App</h1>
      <p>Ứng dụng demo cố tình mắc lỗi cho WPSA: render loop + listener leak + detached DOM + bundle nặng.</p>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Gõ gì đó để kích hoạt render…" />
      <BigButton onClick={() => setText((t) => t + '!')}>Thêm "!"</BigButton>
      <LeakyCounter />
      <SlowText value={text} />
      <LineChart width={0} height={0} data={[]}>
        <Line dataKey="v" />
        <XAxis />
        <YAxis />
        <Tooltip />
      </LineChart>
    </div>
  );
}
`;

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const plan = {
        summary: 'Đã sửa: render loop (thêm deps [] + removeEventListener), leak listener, và đổi lodash sang import subpath.',
        fixes: [
          {
            findingId: 'mock-1',
            file: 'src/App.jsx',
            action: 'modify',
            content: fixedApp,
            rationale: 'Thêm deps cho useEffect, gỡ listener đúng chỗ, import lodash subpath, thay moment bằng Intl.',
          },
        ],
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(plan) } }],
        }),
      );
    });
  })
  .listen(9999, () => console.log('mock AI on :9999'));
