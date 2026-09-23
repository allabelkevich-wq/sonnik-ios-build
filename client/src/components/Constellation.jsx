// Разделитель смысловых частей экрана: линия — три золотые точки — линия.
export default function Constellation({ twinkle = true, style }) {
  return (
    <div className={twinkle ? 'v3-const v3-const--twinkle' : 'v3-const'} style={style}>
      <span className="v3-const__line" />
      <span className="v3-const__dot" />
      <span className="v3-const__dot v3-const__dot--c" />
      <span className="v3-const__dot" />
      <span className="v3-const__line" />
    </div>
  );
}
