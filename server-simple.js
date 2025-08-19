const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './data.json';

// Middleware de sécurité
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.'
});
app.use(limiter);

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  message: 'Trop de messages envoyés, veuillez réessayer dans une heure.'
});

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Initialiser la base de données JSON
function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      contacts: [],
      visits: [],
      projects: [],
      newsletter: [],
      downloads: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Base de données JSON initialisée.');
  }
}

// Lire les données
function readDB() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erreur lecture DB:', error);
    return { contacts: [], visits: [], projects: [], newsletter: [], downloads: [] };
  }
}

// Écrire les données
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Erreur écriture DB:', error);
    return false;
  }
}

// Middleware pour enregistrer les visites
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const db = readDB();
    const visit = {
      id: uuidv4(),
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      page: req.path,
      referrer: req.get('Referrer') || null,
      created_at: new Date().toISOString()
    };
    
    db.visits.push(visit);
    writeDB(db);
  }
  next();
});

// Route pour s'abonner à la newsletter
app.post('/api/newsletter',
  contactLimiter,
  [
    body('email').isEmail().normalizeEmail()
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Email invalide'
      });
    }

    const { email } = req.body;
    const db = readDB();
    
    // Vérifier si l'email existe déjà
    const existingSubscriber = db.newsletter?.find(sub => sub.email === email);
    if (existingSubscriber) {
      return res.json({
        success: true,
        message: 'Vous êtes déjà abonné à la newsletter!'
      });
    }
    
    // Initialiser le tableau newsletter s'il n'existe pas
    if (!db.newsletter) {
      db.newsletter = [];
    }
    
    const subscriber = {
      id: uuidv4(),
      email,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      created_at: new Date().toISOString(),
      status: 'active'
    };
    
    db.newsletter.push(subscriber);
    
    if (writeDB(db)) {
      res.json({
        success: true,
        message: 'Inscription réussie! Merci de vous être abonné à ma newsletter.'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'inscription'
      });
    }
  }
);

// Route pour téléchargement de CV avec tracking
app.get('/api/download-cv', (req, res) => {
  try {
    const db = readDB();
    const downloadData = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent') || 'Unknown',
      referrer: req.get('Referrer') || 'Direct'
    };
    
    // Ajouter le téléchargement à la base de données
    if (!db.downloads) db.downloads = [];
    db.downloads.push(downloadData);
    writeDB(db);
    
    // Chemin vers le CV
    const cvPath = path.join(__dirname, 'documents', 'CV-Warisse-Otchade.pdf');
    
    // Vérifier si le fichier existe
    if (!fs.existsSync(cvPath)) {
      return res.status(404).json({ error: 'CV non trouvé' });
    }
    
    // Envoyer le fichier avec les bons headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="CV-Warisse-Otchade.pdf"');
    res.sendFile(cvPath);
    
    console.log(`📄 CV téléchargé par ${req.ip}`);
  } catch (error) {
    console.error('Erreur téléchargement CV:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour soumettre un message de contact
app.post('/api/contact', 
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Le nom doit contenir entre 2 et 100 caractères'),
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('message').trim().isLength({ min: 10, max: 1000 }).withMessage('Le message doit contenir entre 10 et 1000 caractères')
  ],
  contactLimiter, (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const { name, email, subject, message } = req.body;
    const db = readDB();
    
    const contact = {
      id: uuidv4(),
      name,
      email,
      subject,
      message,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      created_at: new Date().toISOString(),
      status: 'nouveau'
    };
    
    db.contacts.push(contact);
    
    if (writeDB(db)) {
      res.json({
        success: true,
        message: 'Message envoyé avec succès! Je vous répondrai bientôt.'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'envoi du message'
      });
    }
  }
);

// Route pour récupérer les messages (admin)
app.get('/api/admin/contacts', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  
  const db = readDB();
  const contacts = db.contacts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  const paginatedContacts = contacts.slice(offset, offset + limit);
  const total = contacts.length;
  
  res.json({
    success: true,
    data: paginatedContacts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

// Route pour obtenir les statistiques admin
app.get('/api/admin/stats', (req, res) => {
  try {
    const db = readDB();
    const stats = {
      totalContacts: db.contacts.length,
      unreadContacts: db.contacts.filter(c => c.status === 'nouveau').length,
      totalVisits: db.visits.length,
      totalNewsletterSubscribers: db.newsletter ? db.newsletter.length : 0,
      totalDownloads: db.downloads ? db.downloads.length : 0,
      recentContacts: db.contacts.slice(-5).reverse(),
      recentDownloads: db.downloads ? db.downloads.slice(-10).reverse() : [],
      visitsByDay: getVisitsByDay(db.visits)
    };
    res.json(stats);
  } catch (error) {
    console.error('Erreur stats admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
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
  
  const db = readDB();
  const contactIndex = db.contacts.findIndex(c => c.id === id);
  
  if (contactIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Contact non trouvé'
    });
  }
  
  db.contacts[contactIndex].status = status;
  
  if (writeDB(db)) {
    res.json({
      success: true,
      message: 'Statut mis à jour'
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour'
    });
  }
});

// Route pour servir la page d'administration
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Route principale
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

// Initialiser la DB et démarrer le serveur
initDB();

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
  console.log(`📊 Interface admin: http://localhost:${PORT}/admin`);
});
