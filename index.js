const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;



// const calculateOrderAmount = (items) => {
//     // Calculate the order total on the server to prevent
//     // people from directly manipulating the amount on the client
//     let total = 0;
//     items.forEach((item) => {
//         total += item.amount;
//     });
//     return total;
// };



// middleware
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "https://cure-medix.web.app",
            "https://cure-medix.firebaseapp.com",
            "https://cure-medix-by-hafiz-al-shams1917.netlify.app",
        ],
        credentials: true,
    })
);
app.use(express.json());




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
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");




        const medicineCollection = client.db('cureMedixDB').collection('medicines');
        const userCollection = client.db("cureMedixDB").collection("users");
        const cartCollection = client.db("cureMedixDB").collection("carts");
        const categoryCollection = client.db("cureMedixDB").collection("categories");
        const paymentCollection = client.db("cureMedixDB").collection("payments");


        // JWT related apis
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        })


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
        }

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
        }






        // all medicines related apis

        app.get('/medicines', async (req, res) => {
            const cursor = medicineCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });


        // category related apis
        app.get('/categories', verifyToken, verifyAdmin, async (req, res) => {
            const result = await categoryCollection.find().toArray();
            res.send(result);
        });

        app.get('/categories/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await categoryCollection.findOne(query);
            res.send(result);
        });


        app.post('/categories', verifyToken, verifyAdmin, async (req, res) => {
            const category = req.body;
            const result = await categoryCollection.insertOne(category);
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

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });




        // stripe payment apis
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            console.log(amount, 'amount inside the intent')

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
            console.log('payment info', payment);
            const query = {
                _id: {
                    $in: payment.cartIds.map(id => new ObjectId(id))
                }
            };

            const deleteResult = await cartCollection.deleteMany(query);

            res.send({ paymentResult, deleteResult });
        });


        // stats or analytics
        app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
            const users = await userCollection.estimatedDocumentCount();
            const medicines = await medicineCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();

            // simple but not the best way
            // const payments = await paymentCollection.find().toArray();
            // const revenue = payments.reduce((total, payment) => total + payment.price, 0);

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

            res.send({
                users,
                medicines,
                orders,
                revenue
            })
        })





        // testing
        // testing

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



        // testing
        // testing









        // testing

        // order status
        // app.get('/order-stats', async (req, res) => {
        //     const result = await paymentCollection.aggregate([
        //         {
        //             $unwind: '$medicineIds'
        //         },
        // {
        //     $lookup: {
        //         from: 'medicines',
        //         localField: 'medicineIds',
        //         foreignField: '_id',
        //         as: 'medicineItems'
        //     }
        // },
        // {
        //     $unwind: '$medicineItems'
        // },


        // {
        //     $group: {
        //         _id: '$medicineItems.category',
        //         quantity: { $sum: 1 },
        //         revenue: { $sum: '$medicineItems.price' }
        //     }
        // },
        // {
        //     $project: {
        //         _id: 0,
        //         category: '$_id',
        //         quantity: '$quantity',
        //         revenue: '$revenue'
        //     }
        // }


        //     ]).toArray();

        //     res.send(result);

        // });

        // testing















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