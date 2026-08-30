import { lazy, Suspense, useEffect, useRef, useState } from 'react';
// FIX: import subpath hàm cần dùng thay vì toàn bộ lodash
import sortBy from 'lodash/sortBy';
import BigButton from './components/Button.jsx';

const LineChart = lazy(() => import('recharts').then((m) => ({ default: m.LineChart })));
const Line = lazy(() => import('recharts').then((m) => ({ default: m.Line })));
const XAxis = lazy(() => import('recharts').then((m) => ({ default: m.XAxis })));
const YAxis = lazy(() => import('recharts').then((m) => ({ default: m.YAxis })));
const Tooltip = lazy(() => import('recharts').then((m) => ({ default: m.Tooltip })));

/**
 * Fixture chứa CỐ TÌNH 3 loại bug runtime để demo WPSA:
 * 1. Render loop: useEffect không có deps → chạy lại sau mỗi render
 * 2. Memory leak: addEventListener không remove + tạo detached DOM không giải phóng
 * 3. Re-render lan: component cha state thay đổi liên tục, con không memo
 */
function LeakyCounter() {
  const [n, setN] = useState(0);
  const leaked = useRef([]);

  useEffect(() => {
    // BUG 1: thiếu mảng deps — effect chạy lại sau MỖI render, interval cộng dồn
    const timer = setInterval(() => setN((v) => Math.min(v + 1, 400)), 250);
    // BUG 2: listener đăng ký mỗi render nhưng không bao giờ removeEventListener
    const onResize = () => setN((v) => v);
    window.addEventListener('resize', onResize);
    // BUG 3: DOM node bị tách khỏi document nhưng JS vẫn giữ tham chiếu
    for (let i = 0; i < 25; i++) {
      const detached = document.createElement('div');
      detached.innerHTML = `<span>leak-${n}-${i}</span>`;
      leaked.current.push(detached);
    }
    return () => {
      clearInterval(timer);
      // CỐ TÌNH quên: window.removeEventListener('resize', onResize)
    };
  });

  return (
    <p>
      Số lần render: <strong data-testid="counter">{n}</strong> (đang leak {leaked.current.length} node)
    </p>
  );
}

function SlowText({ value }) {
  // BUG 4: tính toán nặng mỗi render, không useMemo
  const items = sortBy(Array.from({ length: 3000 }, (_, i) => (i * 7 + value.length) % 997));
  return (
    <p>
      {new Date(items[0]).getFullYear()} — {items.length} items sorted, value.length={value.length}
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
      {/* LineChart lazy load — recharts không bị kéo vào bundle chính */}
      <Suspense fallback={null}>
        <LineChart width={0} height={0} data={[]}>
          <Line dataKey="v" />
          <XAxis />
          <YAxis />
          <Tooltip />
        </LineChart>
      </Suspense>
    </div>
  );
}
