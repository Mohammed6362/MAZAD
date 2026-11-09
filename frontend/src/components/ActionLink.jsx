import { Link } from 'react-router-dom';

export default function ActionLink({
  as: Component = Link,
  title = 'يفتح في تبويب جديد',
  ...props
}) {
  return <Component {...props} title={title} target="_blank" rel="noopener noreferrer" />;
}
