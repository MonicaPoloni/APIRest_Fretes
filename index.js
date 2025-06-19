const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const Joi = require('joi');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const helmet = require('helmet');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('dev'));

// Swagger setup
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'API de Frete Magalu',
    version: '1.0.0',
    description: 'API robusta para cálculo de frete e rastreamento de pedidos com integração em plataformas.'
  },
  servers: [
    { url: `http://localhost:${port}/api/v1` }
  ]
};
const options = {
  swaggerDefinition,
  apis: [path.join(__dirname, 'index.js')],
};
const swaggerSpec = swaggerJsdoc(options);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Inicialização do banco de dados (persistente)
const db = new sqlite3.Database(path.join(__dirname, 'rastreamentos.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rastreamentos (
    codigo TEXT PRIMARY KEY,
    pedido_id TEXT,
    status TEXT,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Versionamento da API
const router = express.Router();

// Schemas Joi
const freteSchema = Joi.object({
  origem: Joi.string().required(),
  destino: Joi.string().required(),
  peso: Joi.number().required(),
  dimensoes: Joi.object({
    altura: Joi.number().required(),
    largura: Joi.number().required(),
    comprimento: Joi.number().required()
  }).required()
});

const rastreamentoSchema = Joi.object({
  pedido_id: Joi.string().required(),
  status: Joi.string().required()
});

const statusSchema = Joi.object({
  status: Joi.string().required()
});

/**
 * @swagger
 * /frete/calcular:
 *   post:
 *     summary: Calcula opções de frete
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FreteRequest'
 *     responses:
 *       200:
 *         description: Opções de frete calculadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 opcoes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       nome:
 *                         type: string
 *                       valor:
 *                         type: number
 *                       prazo:
 *                         type: integer
 */
router.post('/frete/calcular', async (req, res, next) => {
  try {
    await freteSchema.validateAsync(req.body);
    const opcoes = [
      { nome: 'Econômico', valor: 15.90, prazo: 7 },
      { nome: 'Expresso', valor: 29.90, prazo: 3 }
    ];
    res.json({ sucesso: true, opcoes });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /rastreamento:
 *   post:
 *     summary: Cria um código de rastreamento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RastreamentoRequest'
 *     responses:
 *       200:
 *         description: Código de rastreamento criado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 codigo:
 *                   type: string
 *                 pedido_id:
 *                   type: string
 *                 status:
 *                   type: string
 */
router.post('/rastreamento', async (req, res, next) => {
  try {
    await rastreamentoSchema.validateAsync(req.body);
    const { pedido_id, status } = req.body;
    const codigo = 'MAG' + uuidv4().replace(/-/g, '').substr(0, 9).toUpperCase();
    db.run(
      'INSERT INTO rastreamentos (codigo, pedido_id, status) VALUES (?, ?, ?)',
      [codigo, pedido_id, status],
      err => {
        if (err) {
          console.error('Erro ao inserir rastreamento:', err);
          return next(err);
        }
        res.json({ sucesso: true, codigo, pedido_id, status });
      }
    );
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /rastreamento/{codigo}:
 *   get:
 *     summary: Consulta status de rastreamento
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status do rastreamento
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 codigo:
 *                   type: string
 *                 pedido_id:
 *                   type: string
 *                 status:
 *                   type: string
 *                 atualizado_em:
 *                   type: string
 */
router.get('/rastreamento/:codigo', (req, res, next) => {
  const { codigo } = req.params;
  db.get('SELECT * FROM rastreamentos WHERE codigo = ?', [codigo], (err, row) => {
    if (err) {
      console.error('Erro ao consultar rastreamento:', err);
      return next(err);
    }
    if (!row) return res.status(404).json({ sucesso: false, erro: 'Rastreamento não encontrado' });
    res.json({ sucesso: true, ...row });
  });
});

/**
 * @swagger
 * /rastreamento/{codigo}:
 *   patch:
 *     summary: Atualiza status de rastreamento
 *     parameters:
 *       - in: path
 *         name: codigo
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StatusRequest'
 *     responses:
 *       200:
 *         description: Status atualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 codigo:
 *                   type: string
 *                 status:
 *                   type: string
 */
router.patch('/rastreamento/:codigo', async (req, res, next) => {
  try {
    await statusSchema.validateAsync(req.body);
    const { codigo } = req.params;
    const { status } = req.body;
    db.run(
      'UPDATE rastreamentos SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE codigo = ?',
      [status, codigo],
      function (err) {
        if (err) {
          console.error('Erro ao atualizar rastreamento:', err);
          return next(err);
        }
        if (this.changes === 0) return res.status(404).json({ sucesso: false, erro: 'Rastreamento não encontrado' });
        res.json({ sucesso: true, codigo, status });
      }
    );
  } catch (err) {
    next(err);
  }
});

// Rota de teste
router.get('/', (req, res) => {
  res.json({ sucesso: true, mensagem: 'API de frete está funcionando!' });
});

// Usar versionamento
app.use('/api/v1', router);

// Tratamento global de erros
app.use((err, req, res, next) => {
  if (err.isJoi) {
    return res.status(400).json({ sucesso: false, erro: err.details[0].message });
  }
  res.status(500).json({ sucesso: false, erro: err.message || 'Erro interno do servidor' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

/**
 * @swagger
 * components:
 *   schemas:
 *     FreteRequest:
 *       type: object
 *       required:
 *         - origem
 *         - destino
 *         - peso
 *         - dimensoes
 *       properties:
 *         origem:
 *           type: string
 *         destino:
 *           type: string
 *         peso:
 *           type: number
 *         dimensoes:
 *           type: object
 *           properties:
 *             altura:
 *               type: number
 *             largura:
 *               type: number
 *             comprimento:
 *               type: number
 *     RastreamentoRequest:
 *       type: object
 *       required:
 *         - pedido_id
 *         - status
 *       properties:
 *         pedido_id:
 *           type: string
 *         status:
 *           type: string
 *     StatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 */ 
