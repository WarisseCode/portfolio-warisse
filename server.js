const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de sécurité
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limite chaque IP à 100 requêtes par windowMs
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
});
app.use(limiter);

// Rate limiting spécifique pour les contacts
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 messages par heure par IP
  message: 'Trop de messages envoyés, veuillez réessayer dans une heure.'
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Connexion à la base de données SQLite
const db = new sqlite3.Database('./portfolio.db', (err) => {
  if (err) {
    console.error('Erreur lors de la connexion à la base de données:', err.message);
  } else {
    console.log('✅ Connecté à la base de données SQLite.');
    initializeDatabase();
  }
});

// Initialisation de la base de données
function initializeDatabase() {
  // Table pour les messages de contact
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'nouveau'
    )
  `, (err) => {
    if (err) {
      console.error('Erreur lors de la création de la table contacts:', err.message);
    } else {
      console.log('✅ Table contacts initialisée.');
    }
  });

  // Table pour les statistiques de visite
  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip_address TEXT,
      user_agent TEXT,
      page TEXT,
      referrer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Erreur lors de la création de la table visits:', err.message);
    } else {
      console.log('✅ Table visits initialisée.');
    }
  });

  // Table pour les projets (pour future extension)
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      technologies TEXT,
      github_url TEXT,
      demo_url TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'actif',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Erreur lors de la création de la table projects:', err.message);
    } else {
      console.log('✅ Table projects initialisée.');
    }
  });
}

// Middleware pour enregistrer les visites
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const stmt = db.prepare(`
      INSERT INTO visits (ip_address, user_agent, page, referrer)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(
      req.ip,
      req.get('User-Agent'),
      req.path,
      req.get('Referrer') || null
    );
    
    stmt.finalize();
  }
  next();
});

// Routes API

// Route pour soumettre un message de contact
app.post('/api/contact', 
  contactLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('subject').trim().isLength({ min: 5, max: 200 }).escape(),
    body('message').trim().isLength({ min: 10, max: 1000 }).escape()
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const { name, email, subject, message } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO contacts (name, email, subject, message, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      name,
      email,
      subject,
      message,
      req.ip,
      req.get('User-Agent')
    );
    
    stmt.finalize((err) => {
      if (err) {
        console.error('Erreur lors de l\'insertion:', err.message);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de l\'envoi du message'
        });
      }
      
      res.json({
        success: true,
        message: 'Message envoyé avec succès! Je vous répondrai bientôt.'
      });
    });
  }
);

// Route pour récupérer les messages (admin)
app.get('/api/admin/contacts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  
  db.all(`
    SELECT id, name, email, subject, message, created_at, status
    FROM contacts
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset], (err, rows) => {
    if (err) {
      console.error('Erreur lors de la récupération des contacts:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des données'
      });
    }
    
    // Compter le total
    db.get('SELECT COUNT(*) as total FROM contacts', (err, countRow) => {
      if (err) {
        console.error('Erreur lors du comptage:', err.message);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors du comptage'
        });
      }
      
      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / limit)
        }
      });
    });
  });
});

// Route pour les statistiques
app.get('/api/admin/stats', (req, res) => {
  const stats = {};
  
  // Nombre total de contacts
  db.get('SELECT COUNT(*) as total FROM contacts', (err, contactRow) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Erreur' });
    }
    stats.totalContacts = contactRow.total;
    
    // Nombre de visites aujourd'hui
    db.get(`
      SELECT COUNT(*) as total 
      FROM visits 
      WHERE DATE(created_at) = DATE('now')
    `, (err, visitRow) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Erreur' });
      }
      stats.todayVisits = visitRow.total;
      
      // Nombre total de visites
      db.get('SELECT COUNT(*) as total FROM visits', (err, totalVisitRow) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Erreur' });
        }
        stats.totalVisits = totalVisitRow.total;
        
        res.json({
          success: true,
          data: stats
        });
      });
    });
  });
});

// Route pour marquer un contact comme lu
app.put('/api/admin/contacts/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['nouveau', 'lu', 'répondu'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Statut invalide'
    });
  }
  
  db.run(
    'UPDATE contacts SET status = ? WHERE id = ?',
    [status, id],
    function(err) {
      if (err) {
        console.error('Erreur lors de la mise à jour:', err.message);
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de la mise à jour'
        });
      }
      
      res.json({
        success: true,
        message: 'Statut mis à jour'
      });
    }
  );
});

// Route pour servir la page d'administration
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Route principale - servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée'
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur'
  });
});

// Fermeture propre de la base de données
process.on('SIGINT', () => {
  console.log('\n🔄 Fermeture du serveur...');
  db.close((err) => {
    if (err) {
      console.error('Erreur lors de la fermeture de la base de données:', err.message);
    } else {
      console.log('✅ Base de données fermée.');
    }
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📊 Interface admin: http://localhost:${PORT}/admin`);
});
