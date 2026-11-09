/**
 * إضافة السيارة أو تعديلها؛ يجهز بياناتها وصورها وأوراق الملكية الخاصة ويرسلها للمراجعة مع توضيح الرسوم.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { getModelsForMake, modelLabel, normalizeModel } from '../../data/carModels.js';
import { ArrowRight, Camera, Check, ImagePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ActionLink from '../../components/ActionLink.jsx';
import { api, money } from '../../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Loading, Notice } from '../../components/Feedback.jsx';
import { carMakes, normalizeMake } from '../../data/carMakes.js';
import { libyanCities } from '../../data/libyanCities.js';

const initial = {
  vin: '',
  make: '',
  model: '',
  year: '',
  mileage_km: '',
  transmission: '',
  condition: 'good',
  location: '',
  defects_notes: '',
};

export default function SubmitCarPage() {
  const currentYear = Number(
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Africa/Tripoli' }).format(
      new Date(),
    ),
  );
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const vehicleId = !id ? searchParams.get('vehicle') : null;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [policy, setPolicy] = useState(null);
  useEffect(() => {
    api('/api/listing-policy')
      .then(setPolicy)
      .catch((err) => setError(err.message));
  }, []);
  const [loading, setLoading] = useState(Boolean(id || vehicleId));
  const [existingImages, setExistingImages] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [form, setForm] = useState(initial);
  const [files, setFiles] = useState([]);
  const [ownershipFiles, setOwnershipFiles] = useState([]);
  const [ownershipCount, setOwnershipCount] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLoadError('');
    setRejectionReason('');
    if (!id && !vehicleId) {
      setForm(initial);
      setExistingImages([]);
      setOwnershipCount(0);
      setOwnershipFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let alive = true;
    api(vehicleId ? '/api/account/vehicles/' + vehicleId + '/resale' : '/api/account/cars/' + id)
      .then(({ car, vehicle }) => {
        if (!alive) return;
        if (vehicle) {
          setForm({
            ...initial,
            vin: vehicle.vin,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
          });
          setExistingImages([]);
          setFiles([]);
          setOwnershipFiles([]);
          setOwnershipCount(0);
          return;
        }
        if (
          !['pending_review', 'rejected', 'approved'].includes(car.status) ||
          !car.no_open_auction
        ) {
          setLoadError(
            'يمكن تعديل سياراتك قبل بيعها ما دامت دون مزاد مجدول أو نشط. ألغِ الموعد من الإدارة أولًا إن لزم.',
          );
          return;
        }
        setForm(Object.fromEntries(Object.keys(initial).map((key) => [key, car[key] ?? ''])));
        setExistingImages(car.images || []);
        setOwnershipCount(car.ownership_document_count || 0);
        if (car.status === 'rejected')
          setRejectionReason(car.review_notes || 'عدّل بيانات العرض وأعد إرساله للمراجعة.');
      })
      .catch((err) => {
        if (alive) setLoadError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, vehicleId]);

  // روابط المعاينة مؤقتة داخل المتصفح؛ تُلغى بعد تبدل الصور أو مغادرة الصفحة لتحرير الذاكرة.
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach((item) => URL.revokeObjectURL(item.url));
  }, [files]);
  // يحدث حقل السيارة؛ تغيير الماركة يفرغ الموديل السابق حتى لا يبقى مرتبطًا بشركة أخرى.
  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'make' && normalizeMake(value) !== normalizeMake(current.make)
        ? { model: '' }
        : {}),
    }));
  }
  // يفحص نوع وحجم وعدد الصور الجديدة قبل إضافتها إلى قائمة المعاينة المحلية.
  function addFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (existingImages.length + files.length + selected.length > 10)
      return setError('يمكن رفع 10 صور كحد أقصى.');
    if (
      selected.some(
        (file) =>
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 5 * 1024 * 1024,
      )
    )
      return setError('ارفع صور JPG أو PNG أو WebP بحجم لا يتجاوز 5MB للصورة.');
    setError('');
    setFiles([...files, ...selected]);
  }
  // يجمع البيانات والصور والمستندات ومعرفات الصور المحتفظ بها، ثم يرسل إضافة جديدة أو تعديلًا للسيارة.
  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess(false);
    if (!existingImages.length && !files.length)
      return setError('أرفق صورة واحدة على الأقل للسيارة.');
    setBusy(true);
    // multipart يجمع الحقول والملفات؛ أوراق الملكية ترسل بحقل منفصل لتخزينها في المسار الخاص.
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) =>
      payload.append(
        key,
        key === 'make'
          ? normalizeMake(value)
          : key === 'model'
            ? normalizeModel(form.make, value)
            : value,
      ),
    );
    files.forEach((file) => payload.append('images', file));
    ownershipFiles.forEach((file) => payload.append('ownership_documents', file));
    // عند التعديل تُرسل معرفات الصور المتبقية حتى تستطيع الخلفية حذف المحذوف فقط وترتيب الباقي.
    if (id)
      payload.append(
        'keep_image_ids',
        JSON.stringify(existingImages.map((image) => String(image.id))),
      );
    try {
      if (id) {
        await api('/api/account/cars/' + id, {
          method: 'PATCH',
          body: payload,
        });
        navigate('/account/cars');
      } else {
        await api('/api/cars', { method: 'POST', body: payload });
        setSuccess(true);
        setForm(initial);
        setFiles([]);
        setOwnershipFiles([]);
        setOwnershipCount(0);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="page-main">
        <Loading />
      </main>
    );
  if (loadError)
    return (
      <main className="page-main">
        <Notice>{loadError}</Notice>
        <Link to="/account/cars" className="text-link">
          سياراتي
        </Link>
      </main>
    );
  if (user.can_list === false)
    return (
      <main className="page-main">
        <Notice>أوقفت الإدارة صلاحية عرض وتعديل السيارات لهذا الحساب.</Notice>
        <Link to="/account">حسابي</Link>
      </main>
    );
  return (
    <main className="seller-page submit-page">
      <Link to="/account/cars" className="back-link">
        <ArrowRight size={16} /> سياراتي المقدّمة
      </Link>
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">خطوة أولى نحو المزاد</span>
          <h1>
            {id
              ? rejectionReason
                ? 'تعديل العرض المرفوض'
                : 'تعديل وإعادة تقديم السيارة'
              : vehicleId
                ? 'إعادة عرض السيارة للبيع'
                : 'أضف سيارتك'}
          </h1>
          <p>أدخل المعلومات بدقة؛ ستُراجع السيارة قبل ظهورها للمشترين.</p>
        </div>
        <div className="review-chip">
          <span>
            <Check size={15} />
          </span>{' '}
          تظهر بعد اعتماد الإدارة
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {rejectionReason && (
        <Notice>
          سبب رفض الإدارة: {rejectionReason} عدّل البيانات المطلوبة ثم أعد إرسال العرض للمراجعة.
        </Notice>
      )}
      {!id && (
        <p className="muted-note">
          إذا سبق بيع السيارة، استخدم رقم هيكلها نفسه وأرفق صورًا حديثة، وأوراق ملكيتك إن توفرت.
          يرتبط الطلب بسجل السيارة بعد اكتمال البيع السابق، وتراجع الإدارة الملكية قبل العرض.
        </p>
      )}
      {policy && (
        <div className="wallet-bid-note">
          <strong>رسوم عرض السيارة: {money(policy.listing_fee)}</strong>
          <p>
            تُخصم من الرصيد المتاح عند أول اعتماد لهذا الإعلان. إعادة بيع السيارة بإعلان جديد لها
            رسوم عرض جديدة. التعديل وإعادة المراجعة للإعلان نفسه لا يكرران الرسوم. وفّر الرصيد في{' '}
            <ActionLink to="/account/wallet" className="text-link">
              محفظتك
            </ActionLink>{' '}
            قبل الاعتماد.
          </p>
        </div>
      )}
      {id && (
        <p className="muted-note">
          حفظ التعديلات يعيد السيارة لمراجعة الإدارة. لا يمكن تعديل سيارة لديها مزاد مجدول أو نشط أو
          بعد بيعها.
        </p>
      )}
      {success && (
        <div className="notice notice-success">
          <Check size={18} />
          <span>
            وصل طلبك بنجاح، وهو الآن قيد المراجعة.{' '}
            <ActionLink to="/account/cars" className="text-link">
              تابع حالة سيارتك
            </ActionLink>
          </span>
        </div>
      )}
      <form className="submit-form" onSubmit={submit}>
        <section className="form-card">
          <h2>أوراق ملكية السيارة (اختياري)</h2>
          <p className="muted-note">
            يمكنك إرفاق صور واضحة لأوراق الملكية. قرار اعتماد الملكية أو رفض الطلب بيد المدير، سواء
            أرفقت الأوراق أم لم ترفقها. تظهر الأوراق المرفقة في صفحة المزاد بعد الاعتماد.
          </p>
          {ownershipCount > 0 && (
            <p>
              المحفوظ حاليًا: {ownershipCount} مستند. اختيار ملفات جديدة يستبدل المجموعة السابقة عند
              حفظ الطلب.
            </p>
          )}
          <label className="field-label">
            صور أوراق الملكية (اختياري، حتى 5 صور، حتى 5MB للصورة)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                const selected = Array.from(event.target.files || []);
                event.target.value = '';
                if (
                  selected.length > 5 ||
                  selected.some(
                    (file) =>
                      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                      file.size > 5 * 1024 * 1024,
                  )
                )
                  return setError('اختر حتى 5 صور JPG أو PNG أو WebP، بحجم 5MB للصورة كحد أقصى.');
                setOwnershipFiles(selected);
                setError('');
              }}
            />
          </label>
          {ownershipFiles.length > 0 && (
            <div className="ownership-selection">
              <p>المحدد للإرسال: {ownershipFiles.map((file) => file.name).join('، ')}</p>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => setOwnershipFiles([])}
              >
                إلغاء اختيار المستندات
              </button>
            </div>
          )}
        </section>
        <section className="form-card">
          <div className="form-card-heading">
            <span className="form-step">01</span>
            <div>
              <h2>معلومات السيارة</h2>
              <p>أكمل البيانات الأساسية للمركبة.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field-label">
              الماركة *
              <input
                name="make"
                list="car-makes"
                value={form.make}
                onChange={update}
                onBlur={() =>
                  setForm((current) => ({ ...current, make: normalizeMake(current.make) }))
                }
                placeholder="اختر أو اكتب الماركة"
                required
              />
              <datalist id="car-makes">
                {carMakes.map(({ name, arabic }) => (
                  <option key={name} value={name}>
                    {arabic}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="field-label">
              الموديل *
              <input
                name="model"
                list="car-models"
                disabled={!form.make.trim()}
                onBlur={() =>
                  setForm((current) => ({
                    ...current,
                    model: normalizeModel(current.make, current.model),
                  }))
                }
                value={form.model}
                onChange={update}
                placeholder={form.make ? 'اختر أو اكتب الموديل' : 'اختر الماركة أولًا'}
                required
              />
              <datalist id="car-models">
                {getModelsForMake(form.make).map((model) => (
                  <option key={model} value={model}>
                    {modelLabel(form.make, model)}
                  </option>
                ))}
              </datalist>
              <small className="muted-note">
                الموديلات تتبع الماركة المختارة. يمكنك كتابة موديل غير موجود في القائمة.
              </small>
            </label>
            <label className="field-label">
              سنة الصنع *
              <input
                name="year"
                type="number"
                min="1950"
                max={currentYear}
                value={form.year}
                onChange={update}
                placeholder={String(currentYear)}
                required
              />
            </label>
            <label className="field-label">
              رقم الهيكل (VIN) *
              <input
                name="vin"
                value={form.vin}
                onChange={update}
                maxLength="17"
                placeholder="17 خانة"
                required
              />
            </label>
            <label className="field-label">
              المسافة المقطوعة (كم)
              <input
                name="mileage_km"
                type="number"
                min="0"
                value={form.mileage_km}
                onChange={update}
                placeholder="مثال: 45000"
              />
            </label>
            <label className="field-label">
              ناقل الحركة
              <select name="transmission" value={form.transmission} onChange={update}>
                <option value="">اختر</option>
                <option value="automatic">أوتوماتيك</option>
                <option value="manual">يدوي</option>
              </select>
            </label>
            <label className="field-label">
              الحالة العامة *
              <select name="condition" value={form.condition} onChange={update}>
                <option value="excellent">ممتازة</option>
                <option value="good">جيدة</option>
                <option value="fair">مقبولة</option>
                <option value="needs_repair">تحتاج إلى صيانة</option>
              </select>
            </label>
            <label className="field-label">
              المدينة *
              <select name="location" value={form.location} onChange={update} required>
                <option value="" disabled>
                  اختر المدينة
                </option>
                {form.location && !libyanCities.includes(form.location) && (
                  <option value={form.location}>الموقع المحفوظ: {form.location}</option>
                )}
                {libyanCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label field-full">
              ملاحظات أو عيوب
              <textarea
                name="defects_notes"
                value={form.defects_notes}
                onChange={update}
                rows="4"
                placeholder="اذكر أي ملاحظات مهمة عن السيارة…"
              />
            </label>
          </div>
        </section>
        <section className="form-card">
          <div className="form-card-heading">
            <span className="form-step">02</span>
            <div>
              <h2>صور السيارة</h2>
              <p>أضف حتى 10 صور واضحة — JPG أو PNG أو WebP، بحد أقصى 5MB للصورة.</p>
            </div>
          </div>
          {
            <label className="upload-zone">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={addFiles}
                hidden
              />
              <span className="upload-icon">
                <ImagePlus size={22} />
              </span>
              <strong>اختر صور السيارة</strong>
              <small>أظهر السيارة من زوايا متعددة</small>
            </label>
          }
          {previews.length > 0 && (
            <div className="preview-grid">
              {previews.map(({ file, url }, index) => (
                <div className="preview-image" key={`${file.name}-${index}`}>
                  <img src={url} alt={`معاينة الصورة ${index + 1}`} />
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))}
                    aria-label="حذف الصورة"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="car-gallery">
            {existingImages.map((image) => (
              <div className="editable-image" key={image.id}>
                <img src={image.url} alt="صورة السيارة الحالية" />
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() =>
                    setExistingImages(existingImages.filter((item) => item.id !== image.id))
                  }
                >
                  إزالة الصورة
                </button>
              </div>
            ))}
          </div>
          {id && (
            <p className="muted-note">
              يمكنك إزالة صور وإضافة صور جديدة. يلزم الاحتفاظ بصورة واحدة على الأقل.
            </p>
          )}
          <span className="file-count">
            <Camera size={15} /> {existingImages.length + files.length} / 10 صور
          </span>
        </section>
        <div className="submit-actions">
          <p>بإرسال الطلب، تؤكد صحة المعلومات المقدّمة.</p>
          <button className="button button-dark" disabled={busy || !policy}>
            {busy
              ? 'جارٍ الإرسال…'
              : rejectionReason
                ? 'إعادة إرسال العرض للمراجعة'
                : 'إرسال للمراجعة'}{' '}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </main>
  );
}
