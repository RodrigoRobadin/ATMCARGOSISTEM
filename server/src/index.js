import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import invoicesRouter from './routes/invoices.js';
import usersRouter from './routes/users.js';
import dealsRouter from './routes/deals.js';
import dealDocumentsRouter from './routes/dealDocuments.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/', (_req, res) => {
  res.send('API running');
});

app.use('/api/invoices', invoicesRouter);
app.use('/api/users', usersRouter);
app.use('/api/deals', dealsRouter);
app.use('/api/deals', dealDocumentsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
