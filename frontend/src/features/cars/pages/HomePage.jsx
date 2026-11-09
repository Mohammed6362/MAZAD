/**
 * تصفح السيارات المعتمدة؛ يجلب الإعلانات ويطبق البحث ومرشحات الماركة والموديل وحالة العرض.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import {
  getModelsForMake,
  normalizeModel,
  modelLabel,
  modelSearchText,
} from '../../../data/carModels.js';
import {
  ArrowLeft,
  ArrowUpLeft,
  BadgeCheck,
  CarFront,
  ChevronDown,
  CircleHelp,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  Gavel,
  KeyRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import ActionLink from '../../../components/ActionLink.jsx';
import { api } from '../../../api.js';
import CarCard from '../../../components/CarCard.jsx';
import { EmptyState, Loading, Notice } from '../../../components/Feedback.jsx';
import {
  getMakeOptions,
  makeLabel,
  makeSearchText,
  normalizeMake,
} from '../../../data/carMakes.js';

const heroImage = '/images/hero-car.jpg';

export default function HomePage() {
  const [cars, setCars] = useState([]);
  const [query, setQuery] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');

  // علامة alive تمنع تحديث الحالة إذا وصل رد الشبكة بعد مغادرة الصفحة.
  useEffect(() => {
    let alive = true;
    let pending = false;
    let loaded = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const data = await api('/api/cars');
        if (!alive) return;
        const visible = (data.cars || []).filter((car) => car.status === 'approved');
        setCars(visible);
        setState('ready');
        setError('');
        loaded = true;
      } catch (err) {
        if (alive && !loaded) {
          setError(err.message);
          setState('error');
        }
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const makes = useMemo(() => getMakeOptions(cars.map((car) => car.make)), [cars]);
  const models = useMemo(
    () =>
      getModelsForMake(
        make,
        cars.filter((car) => normalizeMake(car.make) === make).map((car) => car.model),
      ),
    [make, cars],
  );
  // المرشحات تعمل على البيانات المحملة؛ تشمل البحث العربي والاسم القياسي وتبعية الموديل للماركة.
  const filtered = useMemo(
    () =>
      cars.filter((car) => {
        const words =
          `${makeSearchText(car.make)} ${modelSearchText(car.make, car.model)} ${car.year || ''} ${car.location || ''}`.toLocaleLowerCase();
        return (
          words.includes(query.trim().toLocaleLowerCase()) &&
          (!make || normalizeMake(car.make).toLocaleLowerCase() === make.toLocaleLowerCase()) &&
          (!model ||
            normalizeModel(car.make, car.model).toLocaleLowerCase() === model.toLocaleLowerCase())
        );
      }),
    [cars, query, make, model],
  );

  return (
    <main>
      <section className="hero-wrap">
        <div className="hero-panel" style={{ '--hero-image': `url("${heroImage}")` }}>
          <div className="hero-content">
            <span className="eyebrow">
              <Sparkles size={14} /> وجهتك الجديدة لعالم السيارات
            </span>
            <h1>
              سيارتك القادمة
              <br />
              تبدأ <em>من هنا.</em>
            </h1>
            <p>اكتشف سيارة تشبهك. تفاصيل واضحة، مزادات سهلة، وكل خطوة في مكان واحد.</p>
            <div className="hero-buttons">
              <a href="#cars" className="button button-lime">
                استكشف السيارات <ArrowLeft size={17} />
              </a>
              <ActionLink to="/account/cars/new" className="button button-glass">
                اعرض سيارتك
              </ActionLink>
            </div>
            <div className="hero-proof">
              <span>
                <ShieldCheck size={17} /> سيارات معتمدة
              </span>
              <span>
                <TimerReset size={17} /> مزادات بوقت واضح
              </span>
            </div>
          </div>
          <div className="hero-note">
            <span className="note-icon">
              <CarFront size={18} />
            </span>
            <span>
              مساحة أكبر للاختيار
              <small>
                {state === 'ready'
                  ? `${cars.length} سيارة متاحة للاستكشاف`
                  : 'اكتشف السيارات المعتمدة'}
              </small>
            </span>
            <ArrowUpLeft size={18} />
          </div>
        </div>
        <div className="hero-caption">
          <span>مزاد ليبيا</span>
          <span>سوق يجمع ليبيا — من الشرق إلى الغرب</span>
        </div>
      </section>

      <section className="trust-strip" aria-label="مميزات المنصة">
        <div>
          <span className="trust-icon">
            <BadgeCheck size={20} />
          </span>
          <span>
            <strong>مركبات تمت مراجعتها</strong>
            <small>معلومات أوضح قبل قرارك</small>
          </span>
        </div>
        <div>
          <span className="trust-icon">
            <TimerReset size={20} />
          </span>
          <span>
            <strong>تابع المزاد بسهولة</strong>
            <small>حالة ووقت كل مزاد بوضوح</small>
          </span>
        </div>
        <div>
          <span className="trust-icon">
            <CircleHelp size={20} />
          </span>
          <span>
            <strong>خطوات بيع بسيطة</strong>
            <small>قدّم سيارتك للمراجعة</small>
          </span>
        </div>
      </section>

      <section className="listings-section" id="cars">
        <div className="section-topline">
          <div>
            <span className="section-kicker">اختيارات مميزة</span>
            <h2>سيارات في المزاد</h2>
            <p>اكتشف السيارات المعتمدة وتفاصيل كل مزاد.</p>
          </div>
          <ActionLink className="text-link" to="/account/cars/new">
            هل تريد بيع سيارتك؟ <ArrowLeft size={16} />
          </ActionLink>
        </div>
        <div className="listing-toolbar">
          <label className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن الماركة أو الموديل…"
              aria-label="البحث عن سيارة"
            />
            <kbd>⌕</kbd>
          </label>
          <label className="filter-select">
            <SlidersHorizontal size={16} />
            <select
              value={make}
              onChange={(event) => {
                setMake(event.target.value);
                setModel('');
              }}
              aria-label="تصفية حسب الماركة"
            >
              <option value="">كل الماركات</option>
              {makes.map((item) => (
                <option key={item} value={item}>
                  {makeLabel(item)}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <label className="filter-select">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!make}
              aria-label="تصفية حسب الموديل"
            >
              <option value="">{make ? 'كل الموديلات' : 'اختر الماركة أولًا'}</option>
              {models.map((value) => (
                <option key={value} value={value}>
                  {modelLabel(make, value)}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          <span className="result-total">
            {state === 'ready' ? `${filtered.length} سيارة` : '—'}
          </span>
        </div>
        {state === 'loading' && <Loading label="نبحث عن السيارات المتاحة…" />}
        {state === 'error' && <Notice>{error}. تأكد من تشغيل الخادم واتصال قاعدة البيانات.</Notice>}
        {state === 'ready' &&
          (filtered.length ? (
            <div className="cars-grid">
              {filtered.map((car) => (
                <CarCard key={car.id} car={car} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="لا توجد سيارات مطابقة الآن"
              description={
                cars.length
                  ? 'جرّب البحث باسم أو ماركة مختلفة.'
                  : 'ستظهر السيارات بعد اعتمادها وإضافتها إلى المزاد.'
              }
            />
          ))}
      </section>

      <section className="how-it-works" aria-label="كيف تبدأ مع مزاد ليبيا">
        <div className="section-topline">
          <div>
            <span className="section-kicker">من التصفح إلى الاستلام</span>
            <h2>رحلتك تبدأ بثلاث خطوات.</h2>
            <p>تجربة واضحة، من أول اختيار إلى سيارتك القادمة.</p>
          </div>
          <ActionLink className="text-link" to="/auction-rules">
            تعرّف على طريقة المزاد <ArrowLeft size={16} />
          </ActionLink>
        </div>
        <div className="steps-grid">
          {[
            {
              number: '01',
              Icon: Search,
              title: 'اكتشف الخيارات',
              text: 'تصفّح السيارات والصور، وقارن التفاصيل حتى تجد ما يناسبك.',
            },
            {
              number: '02',
              Icon: Gavel,
              title: 'شارك بثقة',
              text: 'سجّل حسابك، راجع قواعد المزاد، وتابع السعر والوقت قبل تقديم عرضك.',
            },
            {
              number: '03',
              Icon: KeyRound,
              title: 'أكمل رحلتك',
              text: 'عند الفوز، تابع فاتورتك وخطوات السداد والتسليم من حسابك.',
            },
          ].map(({ number, Icon, title, text }) => (
            <article className="step-card" key={number}>
              <div className="step-top">
                <span className="step-icon">
                  <Icon size={25} />
                </span>
                <span className="step-number">{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seller-banner">
        <div className="seller-banner-orbit" />
        <div>
          <span className="section-kicker light-kicker">لديك سيارة للبيع؟</span>
          <h2>خلّها توصل للمشتري المناسب.</h2>
          <p>قدّم بيانات سيارتك وصورها، وفريقنا يراجعها قبل ظهورها في المزاد.</p>
        </div>
        <ActionLink to="/account/cars/new" className="button button-lime">
          ابدأ بخطوة <ArrowLeft size={17} />
        </ActionLink>
      </section>
    </main>
  );
}
