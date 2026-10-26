const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;


// middleware
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "http://localhost:5174",
            "https://cure-medix.web.app",
            "https://cure-medix.firebaseapp.com",
            "https://cure-medix-by-hafiz-al-shams1917.netlify.app",
            "https://cure-medix.vercel.app",
        ],
        credentials: true,
    })
);
app.use(express.json());


// demo doctors (auto-inserted into the "doctors" collection the first time /doctors is called)
const defaultSlots = ["09:30 AM", "11:00 AM", "02:15 PM", "04:00 PM", "05:30 PM", "07:00 PM"];
const seedDoctors = [
    { name: "Dr. Sarah Jenkins", specialty: "General Practitioner", group: "General Practice", rating: 4.9, reviews: 142, years: 12, fee: 35, nextTime: "11:00 AM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&h=200&fit=crop" },
    { name: "Dr. Mateo Novak", specialty: "Dermatology", group: "Dermatology", rating: 4.8, reviews: 98, years: 9, fee: 45, nextTime: "02:15 PM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=200&h=200&fit=crop" },
    { name: "Dr. Elena Petrova", specialty: "Pediatrics", group: "Pediatrics", rating: 5.0, reviews: 210, years: 15, fee: 40, nextTime: "09:30 AM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=200&h=200&fit=crop" },
    { name: "Dr. Oliver Dupont", specialty: "Cardiology", group: "Cardiology", rating: 4.9, reviews: 87, years: 18, fee: 60, nextTime: "11:00 AM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=200&h=200&fit=crop" },
    { name: "Dr. Sophie Müller", specialty: "General Practitioner", group: "General Practice", rating: 4.7, reviews: 115, years: 8, fee: 30, nextTime: "04:00 PM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1527613426441-4da17471b66d?w=200&h=200&fit=crop" },
    { name: "Dr. Luca Moretti", specialty: "Neurology", group: "Neurology", rating: 4.9, reviews: 76, years: 14, fee: 55, nextTime: "02:15 PM", slots: defaultSlots, img: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=200&h=200&fit=crop" },
];


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.bkfjr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const medicineCollection = client.db('cureMedixDB').collection('medicines');
        // ✅ deleted medicines are archived here, so a seller's past sales never disappear from reports
        const deletedMedicineCollection = client.db('cureMedixDB').collection('deletedMedicines');
        const userCollection = client.db("cureMedixDB").collection("users");
        const cartCollection = client.db("cureMedixDB").collection("carts");
        const categoryCollection = client.db("cureMedixDB").collection("categories");
        const paymentCollection = client.db("cureMedixDB").collection("payments");
        const categoryImageCollection = client.db("cureMedixDB").collection("categoryImages");
        const bannerCollection = client.db("cureMedixDB").collection("banners");
        // collections for the Online Doctor feature
        const doctorCollection = client.db("cureMedixDB").collection("doctors");
        const appointmentCollection = client.db("cureMedixDB").collection("appointments");


        // JWT related apis
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });


        // JWT related middlewares
        const verifyToken = (req, res, next) => {
            // console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' });
                }
                req.decoded = decoded;
                next();
            })
        };

        // using verify admin after verifyToken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        };





        // all medicines related apis

        app.get('/medicines', async (req, res) => {
            const cursor = medicineCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });


        app.get('/medicines/:email', async (req, res) => {
            const email = req.params.email;
            const query = { seller: email }
            const result = await medicineCollection.find(query).toArray();
            res.send(result);
        })


        app.get('/searchMedicines', async (req, res) => {
            const searchText = req.query.search || '';

            const query = {
                $or: [
                    { name: { $regex: searchText, $options: 'i' } }, // while Searching by name (case-insensitive)
                    { type: { $regex: searchText, $options: 'i' } }  // while Searching by type (case-insensitive)
                ]
            };

            const result = await medicineCollection.find(query).toArray();
            res.send(result);
        });


        // ✅ a seller updates ONE of his OWN medicines (ownership is checked on the server)
        app.patch('/medicines/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid medicine id' });
                }

                const medicine = await medicineCollection.findOne({ _id: new ObjectId(id) });
                if (!medicine) return res.status(404).send({ message: 'Medicine not found' });
                if (medicine.seller !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' }); // not this seller's medicine
                }

                const b = req.body;
                const name = String(b.name || '').trim();
                const description = String(b.description || '').trim();
                const type = String(b.type || '').trim();
                const category = String(b.category || '').trim();
                const company = String(b.company || '').trim();
                const unit = String(b.unit || 'Mg').trim();
                const price = Number(b.price);
                const stock = Number(b.stock);
                const discount = b.discount === true || b.discount === 'true';
                const percent = discount ? parseInt(b.discountPercentage, 10) || 0 : 0;

                if (!name || name.length > 100) return res.status(400).send({ message: 'Medicine name is required (max 100 characters).' });
                if (!description) return res.status(400).send({ message: 'Description is required.' });
                if (!type || !category || !company) return res.status(400).send({ message: 'Type, category and company are required.' });
                if (!Number.isFinite(price) || price < 0) return res.status(400).send({ message: 'Please enter a valid price.' });
                if (!Number.isInteger(stock) || stock < 0) return res.status(400).send({ message: 'Stock must be a whole number (0 or more).' });
                if (percent < 0 || percent > 100) return res.status(400).send({ message: 'Invalid discount percentage.' });

                const updatedDoc = {
                    name, description, type, category, company, unit, price, stock,
                    discount,
                    discountPercentage: `${percent}%`,
                    updatedAt: new Date(),
                };
                // image is optional on update: only replace it if a new one was sent
                if (b.image && typeof b.image === 'string') updatedDoc.image = b.image;

                const result = await medicineCollection.updateOne({ _id: medicine._id }, { $set: updatedDoc });

                // keep the category counters correct if the seller moved the medicine to another category
                if (medicine.category !== category) {
                    await categoryCollection.updateOne({ name: medicine.category, count: { $gt: 0 } }, { $inc: { count: -1 } });
                    await categoryCollection.updateOne({ name: category }, { $inc: { count: 1 } });
                }

                res.send({ success: true, modifiedCount: result.modifiedCount });
            } catch (error) {
                console.error('Error updating medicine:', error);
                res.status(500).send({ message: 'Failed to update medicine' });
            }
        });


        // ✅ a seller deletes ONE of his OWN medicines (a copy is archived so his sales history stays correct)
        app.delete('/medicines/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: 'Invalid medicine id' });
                }

                const medicine = await medicineCollection.findOne({ _id: new ObjectId(id) });
                if (!medicine) return res.status(404).send({ message: 'Medicine not found' });
                if (medicine.seller !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const { _id, ...rest } = medicine;
                await deletedMedicineCollection.insertOne({ ...rest, originalId: _id, deletedAt: new Date() });
                const result = await medicineCollection.deleteOne({ _id });

                if (medicine.category) {
                    await categoryCollection.updateOne({ name: medicine.category, count: { $gt: 0 } }, { $inc: { count: -1 } });
                }

                res.send({ success: true, deletedCount: result.deletedCount });
            } catch (error) {
                console.error('Error deleting medicine:', error);
                res.status(500).send({ message: 'Failed to delete medicine' });
            }
        });


        // ✅ FIXED: Seller Home dashboard in ONE call (stats + sales rows), only for the logged-in seller
        app.get('/seller-dashboard/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;
                if (email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const [activeMeds, archivedMeds, banners] = await Promise.all([
                    medicineCollection.find({ seller: email }).toArray(),
                    deletedMedicineCollection.find({ seller: email }).toArray(),
                    bannerCollection.find({ seller: email }).toArray(),
                ]);

                // lookup tables: this seller's medicines (current + deleted) by id and by name
                const norm = (v) => String(v || '').trim().toLowerCase();
                const medById = new Map();
                const medByName = new Map();
                activeMeds.forEach((m) => { medById.set(String(m._id), m); medByName.set(norm(m.name), m); });
                archivedMeds.forEach((m) => {
                    medById.set(String(m.originalId), m);
                    if (!medByName.has(norm(m.name))) medByName.set(norm(m.name), m);
                });

                // does this order item belong to this seller? (seller email saved in the order is the main rule)
                const belongsToSeller = (item) => {
                    if (item.seller) return item.seller === email;
                    if (medById.has(String(item.medicineId))) return true;
                    return medByName.has(norm(item.name));
                };

                const round2 = (n) => Math.round(n * 100) / 100;
                const sales = [];

                // only load orders that can contain this seller's items
                const payments = await paymentCollection
                    .find(
                        { $or: [{ 'items.seller': email }, { 'items.medicineId': { $in: [...medById.keys()] } }] },
                        { projection: { transactionId: 1, date: 1, status: 1, items: 1 } }
                    )
                    .toArray();

                for (const p of payments) {
                    const fulfilled = String(p.status || '').toLowerCase() === 'paid'; // approved by admin
                    (p.items || []).forEach((item, idx) => {
                        if (!item || !belongsToSeller(item)) return;

                        const med = medById.get(String(item.medicineId)) || medByName.get(norm(item.name)) || null;

                        let quantity = Number(item.quantity ?? item.qty ?? 1);
                        if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;

                        // use the price saved AT PURCHASE TIME (unitPrice / lineTotal), never today's price
                        let unitPrice = Number(item.unitPrice ?? item.price);
                        if (!Number.isFinite(unitPrice)) unitPrice = Number(med?.price) || 0;
                        const lineTotal = Number(item.lineTotal);
                        const total = Number.isFinite(lineTotal) ? round2(lineTotal) : round2(unitPrice * quantity);

                        sales.push({
                            key: `${p._id}-${idx}`,
                            orderRef: String(p.transactionId || '').slice(-8).toUpperCase(),
                            date: p.date,
                            name: item.name || med?.name || 'Medicine',
                            category: med?.category || item.category || '—',
                            quantity,
                            unitPrice,
                            total,
                            status: fulfilled ? 'Fulfilled' : 'Processing',
                        });
                    });
                }
                sales.sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

                // numbers for the 4 cards
                const sum = (rows) => round2(rows.reduce((t, r) => t + r.total, 0));
                const paidRows = sales.filter((s) => s.status === 'Fulfilled');
                const pendingRows = sales.filter((s) => s.status === 'Processing');
                const acceptedBanners = banners.filter((b) => b.isBanner === true).length;

                res.send({
                    stats: {
                        totalRevenue: sum(paidRows),            // approved by admin
                        paidCount: paidRows.length,
                        pendingRevenue: sum(pendingRows),       // still waiting for admin approval
                        pendingCount: pendingRows.length,
                        medicinesListed: activeMeds.length,
                        totalStock: activeMeds.reduce((t, m) => t + (Number(m.stock) || 0), 0),
                        bannerRequests: banners.length,
                        bannersAccepted: acceptedBanners,
                        bannersPending: banners.length - acceptedBanners,
                    },
                    sales,
                });
            } catch (error) {
                console.error('Error building seller dashboard:', error);
                res.status(500).send({ message: 'Failed to load seller dashboard' });
            }
        });



        // GET /banners - Fetch all banners from bannerCollection
        app.get('/banners', async (req, res) => {
            const cursor = bannerCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });

        // POST /banners - Add a new banner to bannerCollection
        app.post('/banners', async (req, res) => {
            const newBanner = req.body;
            const result = await bannerCollection.insertOne(newBanner);
            res.send(result);
        });

        // GET /banners/seller/:email - Fetch banners for a specific seller
        app.get('/banners/seller/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const cursor = bannerCollection.find({ seller: email });
                const result = await cursor.toArray();
                res.send(result);
            } catch (error) {
                console.error("Error fetching banners:", error);
                res.status(500).send({ message: "Failed to fetch banners" });
            }
        });


        app.patch('/banners/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { isBanner } = req.body;
            const result = await bannerCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { isBanner } }
            );
            res.send(result);
        });

        app.delete('/banners/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            try {
                const result = await bannerCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 1) {
                    res.send({ message: "Banner deleted successfully" });
                } else {
                    res.status(404).send({ error: "Banner not found" });
                }
            } catch (error) {
                console.error("Error deleting banner:", error);
                res.status(500).send({ error: "Failed to delete banner" });
            }
        });
        // 


        // category related apis
        app.get('/categories', async (req, res) => {
            const result = await categoryCollection.find().toArray();
            res.send(result);
        });

        app.get('/categories/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await categoryCollection.findOne(query);
            res.send(result);
        });

        app.post('/medicines', async (req, res) => {
            const medicine = req.body;
            const result = await medicineCollection.insertOne(medicine);
            res.send(result);
        });


        app.post('/categories', verifyToken, verifyAdmin, async (req, res) => {
            const category = req.body;
            const result = await categoryCollection.insertOne(category);
            res.send(result);
        });

        app.post('/categoryImages', verifyToken, verifyAdmin, async (req, res) => {
            const categoryImage = req.body;
            const result = await categoryImageCollection.insertOne(categoryImage);
            res.send(result);
        });


        app.get('/categoryImages', async (req, res) => {
            const cursor = categoryImageCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });


        // testing area
        app.patch('/categories/addCount/:categoryName', async (req, res) => {
            const categoryName = req.params.categoryName;
            const filter = { name: categoryName };
            const updateDoc = {
                $inc: { count: 1 },
            };
            const result = await categoryCollection.updateOne(filter, updateDoc);
            res.send(result);
        });



        app.patch('/categoryImages/:name', verifyToken, verifyAdmin, async (req, res) => {
            const updatedImage = req.body;
            const name = req.params.name;
            const filter = { categoryName: name }
            const updatedDoc = {
                $set: {
                    // categoryName: updatedImage.categoryName,
                    imageUrl: updatedImage.imageUrl,

                }
            }
            const options = { upsert: true };

            const result = await categoryImageCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });




        app.patch('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
            const category = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    name: category.name,
                    image: category.image,
                    details: category.details,
                }
            }

            const result = await categoryCollection.updateOne(filter, updatedDoc)
            res.send(result);
        });

        app.delete('/categories/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await categoryCollection.deleteOne(query);
            res.send(result);
        });





        // users apis
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            // console.log(req.headers);
            const result = await userCollection.find().toArray();
            res.send(result);
        });


        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'admin';
            }
            res.send({ admin });
        })


        app.get('/users/seller/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let seller = false;
            if (user) {
                seller = user?.role === 'seller';
            }

            res.send({ seller });
        });


        // ✅ the logged-in user's own saved profile details (name + phone) for the Profile page
        app.get('/users/profile/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;
                if (email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }
                const user = await userCollection.findOne({ email }, { projection: { name: 1, phoneNumber: 1, _id: 0 } });
                res.send({ name: user?.name || null, phoneNumber: user?.phoneNumber || null });
            } catch (error) {
                console.error('Error fetching profile:', error);
                res.status(500).send({ message: 'Failed to fetch profile' });
            }
        });

        // ✅ update the logged-in user's own name + phone (email can never be changed here)
        app.patch('/users/profile/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;
                if (email !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' });
                }

                const name = String(req.body.name || '').trim();
                const phoneNumber = String(req.body.phoneNumber || '').trim();

                if (name.length < 2 || name.length > 60) {
                    return res.status(400).send({ message: 'Name must be between 2 and 60 characters.' });
                }
                // phone is optional; if given it must look like a real number
                if (phoneNumber && !/^\+?[0-9\s\-()]{7,20}$/.test(phoneNumber)) {
                    return res.status(400).send({ message: 'Please enter a valid phone number.' });
                }

                await userCollection.updateOne(
                    { email },
                    { $set: { name, phoneNumber, profileUpdatedAt: new Date() } },
                    { upsert: true }
                );
                res.send({ success: true, name, phoneNumber });
            } catch (error) {
                console.error('Error updating profile:', error);
                res.status(500).send({ message: 'Failed to update profile' });
            }
        });


        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'user already exists', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });



        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });


        app.patch('/users/makeUser/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'user'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });

        app.patch('/users/makeSeller/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'seller'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });




        app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })



        // cart apis
        app.get('/carts', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const cartItem = req.body;
            const result = await cartCollection.insertOne(cartItem);
            res.send(result);
        });

        // saves the quantity chosen on the Cart page, so it survives a reload
        app.patch('/carts/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const quantity = Number(req.body.quantity);

                // accept only whole numbers from 1 to 999
                if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
                    return res.status(400).send({ message: 'Quantity must be a whole number between 1 and 999' });
                }

                const filter = { _id: new ObjectId(id) };
                const updatedDoc = { $set: { quantity } };
                const result = await cartCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                console.error('Error updating cart quantity:', error);
                res.status(500).send({ message: 'Failed to update quantity' });
            }
        });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });


        // testing area
        app.delete('/clearCarts', async (req, res) => {
            const email = req.query.email;
            if (!email) {
                return res.status(400).send({ message: "Email is required" });
            }
            const query = { email: email };
            const result = await cartCollection.deleteMany(query);
            res.send(result);

        });


        // ═════════ ONLINE DOCTOR APIS ═════════

        // Makes sure demo doctors exist (idempotent: upsert by name, so never duplicates)
        let seeding = null;
        const ensureDoctors = () => {
            if (!seeding) {
                seeding = (async () => {
                    const count = await doctorCollection.estimatedDocumentCount();
                    if (count === 0) {
                        await doctorCollection.bulkWrite(
                            seedDoctors.map((d) => ({ updateOne: { filter: { name: d.name }, update: { $setOnInsert: d }, upsert: true } }))
                        );
                    }
                })().finally(() => { seeding = null; });
            }
            return seeding;
        };

        // all doctors (public)
        app.get('/doctors', async (req, res) => {
            try {
                await ensureDoctors();
                const result = await doctorCollection.find().sort({ _id: 1 }).toArray();
                res.send(result);
            } catch (error) {
                console.error('Error fetching doctors:', error);
                res.status(500).send({ message: 'Failed to fetch doctors' });
            }
        });

        // already booked times of one doctor on one date -> ["11:00 AM", ...] (public, used to disable slots)
        app.get('/appointment-slots', async (req, res) => {
            try {
                const { doctorId, date } = req.query;
                if (!doctorId || !date) return res.send([]);
                const booked = await appointmentCollection
                    .find({ doctorId, dateISO: date, status: { $ne: 'cancelled' } })
                    .project({ time: 1, _id: 0 })
                    .toArray();
                res.send(booked.map((b) => b.time));
            } catch (error) {
                console.error('Error fetching slots:', error);
                res.status(500).send({ message: 'Failed to fetch slots' });
            }
        });

        // all appointments of the logged-in user (own email only)
        app.get('/appointments/:email', verifyToken, async (req, res) => {
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await appointmentCollection.find({ email: req.params.email }).sort({ date: -1 }).toArray();
            res.send(result);
        });

        // create an appointment AFTER the Stripe payment succeeded (status is always "pending" at first)
        app.post('/appointments', verifyToken, async (req, res) => {
            try {
                const b = req.body;
                const email = req.decoded.email; // never trust the email from the browser

                // 1) basic validation
                if (!b.doctorId || !ObjectId.isValid(b.doctorId) || !/^\d{4}-\d{2}-\d{2}$/.test(b.dateISO || '') || !b.time || !b.transactionId || !b.patientName?.trim() || !b.reason?.trim()) {
                    return res.status(400).send({ message: 'Invalid booking data' });
                }

                // 2) doctor must exist and the time must be one of his slots
                const doctor = await doctorCollection.findOne({ _id: new ObjectId(b.doctorId) });
                if (!doctor) return res.status(404).send({ message: 'Doctor not found' });
                if (!doctor.slots.includes(b.time)) return res.status(400).send({ message: 'Invalid time slot' });

                // 3) slot must still be free
                const taken = await appointmentCollection.findOne({ doctorId: b.doctorId, dateISO: b.dateISO, time: b.time, status: { $ne: 'cancelled' } });
                if (taken) return res.status(409).send({ message: 'This time slot was just booked by someone else' });

                // 4) the Stripe payment must be real, succeeded and equal to the doctor's fee
                const intent = await stripe.paymentIntents.retrieve(b.transactionId);
                if (intent.status !== 'succeeded' || intent.amount !== Math.round(doctor.fee * 100)) {
                    return res.status(402).send({ message: 'Payment could not be verified' });
                }

                // 5) the same payment cannot create two bookings
                const duplicate = await appointmentCollection.findOne({ transactionId: b.transactionId });
                if (duplicate) return res.status(409).send({ message: 'This payment is already used' });

                const appointment = {
                    type: 'consultation',
                    email,
                    doctorId: b.doctorId,
                    doctorName: doctor.name,
                    specialty: doctor.specialty,
                    doctorImg: doctor.img,
                    patientName: b.patientName.trim(),
                    reason: b.reason.trim(),
                    dateISO: b.dateISO,
                    dateText: b.dateText,
                    time: b.time,
                    price: doctor.fee, // from the database, not from the browser
                    transactionId: b.transactionId,
                    date: new Date(),
                    status: 'pending', // pending | confirmed | cancelled
                };
                const result = await appointmentCollection.insertOne(appointment);
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error('Error creating appointment:', error);
                res.status(500).send({ message: 'Failed to save appointment' });
            }
        });

        // (admin): every appointment of every user, newest first
        app.get('/manage-appointments', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const result = await appointmentCollection.find().sort({ date: -1 }).toArray();
                res.send(result);
            } catch (error) {
                console.error('Error fetching appointments:', error);
                res.status(500).send({ message: 'Failed to fetch appointments' });
            }
        });

        // (admin): change the status of one appointment (pending | confirmed | cancelled)
        app.patch('/manage-appointments/:id', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { status } = req.body;

                if (!ObjectId.isValid(id) || !['pending', 'confirmed', 'cancelled'].includes(status)) {
                    return res.status(400).send({ message: 'Invalid request' });
                }

                const appointment = await appointmentCollection.findOne({ _id: new ObjectId(id) });
                if (!appointment) return res.status(404).send({ message: 'Appointment not found' });

                // bringing a cancelled booking back is only allowed if nobody took its time slot meanwhile
                if (appointment.status === 'cancelled' && status !== 'cancelled') {
                    const taken = await appointmentCollection.findOne({
                        _id: { $ne: appointment._id },
                        doctorId: appointment.doctorId,
                        dateISO: appointment.dateISO,
                        time: appointment.time,
                        status: { $ne: 'cancelled' },
                    });
                    if (taken) {
                        return res.status(409).send({ message: 'This time slot has been booked by another patient, so it cannot be restored.' });
                    }
                }

                const result = await appointmentCollection.updateOne(
                    { _id: appointment._id },
                    { $set: { status, statusUpdatedAt: new Date() } }
                );
                res.send(result);
            } catch (error) {
                console.error('Error updating appointment:', error);
                res.status(500).send({ message: 'Failed to update appointment' });
            }
        });


        // stripe payment apis
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            // console.log(amount, 'amount inside the intent');

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        });


        app.get('/payments/:email', verifyToken, async (req, res) => {
            const query = { email: req.params.email }
            if (req.params.email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        });



        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);

            // deleting each items from the cart
            // console.log('payment info', payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            };

            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ paymentResult, deleteResult });
        });




        // stats
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const medicines = await medicineCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            const result = await paymentCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0;

            const pendingResult = await paymentCollection.aggregate([
                {
                    $match: { status: "pending" }
                },
                {
                    $group: {
                        _id: null,
                        totalPending: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();
            const totalPending = pendingResult.length > 0 ? pendingResult[0].totalPending : 0;


            const paidResult = await paymentCollection.aggregate([
                {
                    $match: { status: "paid" }
                },
                {
                    $group: {
                        _id: null,
                        totalPaid: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();
            const totalPaid = paidResult.length > 0 ? paidResult[0].totalPaid : 0;

            // doctor consultation numbers (kept separate from the medicine numbers above)
            const appointments = await appointmentCollection.estimatedDocumentCount();
            const pendingAppointments = await appointmentCollection.countDocuments({ status: 'pending' });
            const consultationResult = await appointmentCollection.aggregate([
                { $match: { status: { $ne: 'cancelled' } } },
                { $group: { _id: null, total: { $sum: '$price' } } }
            ]).toArray();
            const consultationRevenue = consultationResult.length > 0 ? consultationResult[0].total : 0;

            res.send({
                users,
                medicines,
                orders,
                revenue,
                totalPending,
                totalPaid,
                appointments,
                pendingAppointments,
                consultationRevenue
            })
        })

        // manage payment apis
        app.get('/manage-payments', async (req, res) => {
            const payments = await paymentCollection.find().toArray();
            res.send(payments);
        });


        app.patch('/manage-payments/:transactionId', async (req, res) => {
            const { transactionId } = req.params;
            const filter = { transactionId };
            const updatedDoc = {
                $set: {
                    status: 'paid'
                }
            }
            const result = await paymentCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });


    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('CureMedix server is healing you entirely!')
});


app.listen(port, () => {
    console.log(`CureMedix server is healing you entirely on PORT: ${port}`)
});

console.log(__dirname);
console.log(__filename);