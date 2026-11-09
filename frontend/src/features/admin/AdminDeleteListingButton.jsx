import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api, carName } from '../../api.js';
import { Notice } from '../../components/Feedback.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { routes } from '../../routes.js';

export default function AdminDeleteListingButton({ car, onDeleted }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user?.roles.includes('admin') || car.status === 'deleted') return null;
  async function remove() {
    if (
      !window.confirm(
        `هل تريد حذف ${carName(car)}؟ سيُلغى أي مزاد مفتوح ويُفك حجز المزايدة. تبقى الفواتير والمعاملات القائمة محفوظة.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/cars/${car.id}`, { method: 'DELETE' });
      if (onDeleted) onDeleted(car.id);
      else navigate(routes.adminListings, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="button button-reject" disabled={busy} onClick={remove}>
        <Trash2 size={16} /> {busy ? 'جارٍ الحذف…' : 'حذف العرض'}
      </button>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
