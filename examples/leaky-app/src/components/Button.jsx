export default function BigButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ marginLeft: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #38bdf8', background: '#0ea5e9', color: 'white' }}
    >
      {children}
    </button>
  );
}
