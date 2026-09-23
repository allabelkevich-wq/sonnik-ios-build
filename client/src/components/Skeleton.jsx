// Один прямоугольник — страницы собирают из них форму будущего контента
// (не спиннер: экран должен рендериться при null данных).
export default function Skeleton({ width = '100%', height = 13, radius = 6, style }) {
  return <span className="v3-skel" style={{ width, height, borderRadius: radius, ...style }} />;
}
