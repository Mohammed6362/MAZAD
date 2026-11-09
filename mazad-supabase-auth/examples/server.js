import 'dotenv/config';
import express from 'express';
import { mazadAuthRouter } from '../src/routes.js';
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use('/api', mazadAuthRouter);
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
app.listen(process.env.PORT || 3000, () => console.log('Mazad API started'));
