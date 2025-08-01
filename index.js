require("dotenv").config();
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const port = process.env.PORT || 3000;
const app = express();

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174", "https://pro-fast-curier.web.app"], 
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Firebase token verification middleware
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const idToken = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

async function run() {
  try {
    // await client.connect();
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const db = client.db("PropertyPulseDB");
    const propertiesCollection = db.collection("properties");
    const usersCollection = db.collection("users");
    const wishlistCollection = db.collection("wishlist");
    const reviewsCollection = db.collection("reviews");
    const offersCollection = db.collection("offers");
    const reportsCollection = db.collection("reports");

    // Role checkers
    const verifyAdmin = async (req, res, next) => {
      const email = req?.user?.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });
      next();
    };

    const verifyAgent = async (req, res, next) => {
      const email = req?.user?.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user?.role !== "agent")
        return res
          .status(403)
          .send({ message: "Agent only Actions!", role: user?.role });
      next();
    };

    // ======================= Admin Routes =======================
    // Admin dashboard stats endpoint
    app.get(
      "/admin/dashboard-stats",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const usersCount = await usersCollection.countDocuments();
          const agentsCount = await usersCollection.countDocuments({
            role: "agent",
          });
          const fraudAgentsCount = await usersCollection.countDocuments({
            isFraud: true,
          });
          const propertiesCount = await propertiesCollection.countDocuments();
          const pendingPropertiesCount =
            await propertiesCollection.countDocuments({ status: "pending" });
          const reportedPropertiesCount =
            await reportsCollection.countDocuments();
          const reviewsCount = await reviewsCollection.countDocuments();

          res.json({
            usersCount,
            agentsCount,
            propertiesCount,
            pendingPropertiesCount,
            reportedPropertiesCount,
            reviewsCount,
            fraudAgentsCount,
          });
        } catch (err) {
          res.status(500).json({ error: "Server error" });
        }
      }
    );
    app.get(
      "/admin/properties",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const properties = await propertiesCollection.find().toArray();
          res.send(properties);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch properties" });
        }
      }
    );

    app.patch(
      "/admin/properties/verify/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await propertiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Verified" } }
          );
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to verify property" });
        }
      }
    );

    app.patch(
      "/admin/properties/reject/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await propertiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Rejected" } }
          );
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to reject property" });
        }
      }
    );

    app.get(
      "/admin/users",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const users = await usersCollection.find().toArray();
          res.send(users);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch users" });
        }
      }
    );

    app.patch(
      "/admin/users/make-admin/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: "admin" } }
          );
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to make admin" });
        }
      }
    );

    app.patch(
      "/admin/users/make-agent/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role: "agent" } }
          );
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to make agent" });
        }
      }
    );

    app.patch(
      "/admin/users/mark-fraud/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const user = await usersCollection.findOne({ _id: new ObjectId(id) });
          if (!user) return res.status(404).send({ message: "User not found" });

          await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isFraud: true, role: "fraud" } }
          );
          await propertiesCollection.updateMany(
            { agentEmail: user.email },
            { $set: { status: "Fraud" } }
          );
          res.send({ message: "Marked as fraud and properties removed" });
        } catch (err) {
          res.status(500).send({ message: "Failed to mark as fraud" });
        }
      }
    );

    app.get(
      "/admin/reviews",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reviews = await reviewsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
          res.send(reviews);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch reviews" });
        }
      }
    );

    app.delete(
      "/admin/reviews/:reviewId",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reviewId = req.params.reviewId;
          const result = await reviewsCollection.deleteOne({
            _id: new ObjectId(reviewId),
          });
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to delete review" });
        }
      }
    );

    app.delete(
      "/admin/users/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const user = await usersCollection.findOne({ _id: new ObjectId(id) });
          if (!user) return res.status(404).send({ message: "User not found" });

          await usersCollection.deleteOne({ _id: new ObjectId(id) });
          if (user.firebaseUid) {
            await admin.auth().deleteUser(user.firebaseUid);
          } else {
            const fbUser = await admin.auth().getUserByEmail(user.email);
            await admin.auth().deleteUser(fbUser.uid);
          }

          res.send({ message: "User deleted from DB and Firebase" });
        } catch (err) {
          res
            .status(500)
            .send({ message: "Failed to delete user", error: err.message });
        }
      }
    );

    app.patch(
      "/admin/properties/advertise/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await propertiesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isAdvertised: true } }
          );
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to advertise property" });
        }
      }
    );

    app.get(
      "/admin/verified-properties",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const properties = await propertiesCollection
            .find({ status: "Verified" })
            .toArray();
          res.send(properties);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch properties" });
        }
      }
    );

    app.get(
      "/admin/reports",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const reports = await reportsCollection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
          res.send(reports);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch reports" });
        }
      }
    );

    app.delete(
      "/admin/remove-property/:propertyId",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const propertyId = req.params.propertyId;
          await propertiesCollection.deleteOne({
            _id: new ObjectId(propertyId),
          });
          await reviewsCollection.deleteMany({
            propertyId: new ObjectId(propertyId),
          });
          await reportsCollection.deleteMany({ propertyId });
          res.send({ message: "Property and related reviews removed" });
        } catch (err) {
          res.status(500).send({ message: "Failed to remove property" });
        }
      }
    );

    // ======================= Agent Routes =======================
    // Agent dashboard stats endpoint
app.get("/agent/dashboard-stats", verifyFirebaseToken, verifyAgent, async (req, res) => {
  try {
    const email = req.user.email;

    // Total properties added by this agent
    const addedCount = await propertiesCollection.countDocuments({ agentEmail: email });

    // Verified properties
    const verifiedCount = await propertiesCollection.countDocuments({ agentEmail: email, status: "Verified" });

    // Sold properties (offers with status "bought")
    const soldCount = await offersCollection.countDocuments({ agentEmail: email, status: "bought" });

    // Pending offers for this agent's properties
    const pendingOffersCount = await offersCollection.countDocuments({ agentEmail: email, status: "pending" });

    // Rejected properties
    const rejectedCount = await propertiesCollection.countDocuments({ agentEmail: email, status: "Rejected" });

    // Total earnings (sum of offerAmount for bought offers)
    const soldOffers = await offersCollection.find({ agentEmail: email, status: "bought" }).toArray();
    const totalEarnings = soldOffers.reduce((sum, offer) => sum + Number(offer.offerAmount), 0);

    res.json({
      addedCount,
      verifiedCount,
      soldCount,
      pendingOffersCount,
      rejectedCount,
      totalEarnings,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
    app.patch(
      "/agent/offers/accept/:offerId",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const offerId = req.params.offerId;
          const offer = await offersCollection.findOne({
            _id: new ObjectId(offerId),
          });
          if (!offer)
            return res.status(404).send({ message: "Offer not found" });

          await offersCollection.updateOne(
            { _id: new ObjectId(offerId) },
            { $set: { status: "accepted" } }
          );
          await offersCollection.updateMany(
            {
              propertyId: offer.propertyId,
              _id: { $ne: new ObjectId(offerId) },
            },
            { $set: { status: "rejected" } }
          );
          res.send({ message: "Offer accepted and others rejected" });
        } catch (err) {
          res.status(500).send({ message: "Failed to accept offer" });
        }
      }
    );

    app.patch(
      "/agent/offers/reject/:offerId",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const offerId = req.params.offerId;
          await offersCollection.updateOne(
            { _id: new ObjectId(offerId) },
            { $set: { status: "rejected" } }
          );
          res.send({ message: "Offer rejected" });
        } catch (err) {
          res.status(500).send({ message: "Failed to reject offer" });
        }
      }
    );

    app.get(
      "/agent/offers/:agentEmail",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const agentEmail = req.params.agentEmail;
          const offers = await offersCollection
            .find({ agentEmail })
            .sort({ createdAt: -1 })
            .toArray();
          res.send(offers);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch offers" });
        }
      }
    );

    app.get(
      "/agent/sold-properties/summary/:agentEmail",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const agentEmail = req.params.agentEmail;
          const soldOffers = await offersCollection
            .find({ agentEmail, status: "bought" })
            .toArray();
          const totalSold = soldOffers.reduce(
            (sum, offer) => sum + Number(offer.offerAmount),
            0
          );
          const chartData = [];
          const map = {};
          soldOffers.forEach((offer) => {
            if (!map[offer.propertyTitle]) {
              map[offer.propertyTitle] = 0;
            }
            map[offer.propertyTitle] += Number(offer.offerAmount);
          });
          for (const title in map) {
            chartData.push({ property: title, amount: map[title] });
          }
          res.send({ totalSold, chartData });
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch sold summary" });
        }
      }
    );

    app.get(
      "/agent/sold-properties/:agentEmail",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const agentEmail = req.params.agentEmail;
          const soldOffers = await offersCollection
            .find({ agentEmail, status: "bought" })
            .toArray();
          res.send(soldOffers);
        } catch (err) {
          res.status(500).send({ message: "Failed to fetch sold properties" });
        }
      }
    );

    app.get(
      "/agent/properties",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        const email = req.query.email;
        if (!email)
          return res.status(401).send({ message: "Email is required" });
        const properties = await propertiesCollection
          .find({ agentEmail: email })
          .toArray();
        const agent = await usersCollection.findOne({ email: email });
        const propertiesWithAgentImage = properties.map((property) => ({
          ...property,
          agentImage: agent?.image || null,
        }));
        res.send(propertiesWithAgentImage);
      }
    );

    app.get(
      "/agent/property/:id",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        const id = req.params.id;
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(property);
      }
    );

    app.put(
      "/agent/property/:id",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.json(result);
      }
    );

    app.delete(
      "/agent/property/:id",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        const id = req.params.id;
        const result = await propertiesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json(result);
      }
    );

    // ======================= User/Public Routes =======================
    // User dashboard stats endpoint
app.get("/user/dashboard-stats", verifyFirebaseToken, async (req, res) => {
  try {
    const email = req.user.email;

    // Total wishlisted properties
    const wishlistCount = await wishlistCollection.countDocuments({ userEmail: email });

    // Total properties bought (offers with status "bought")
    const boughtCount = await offersCollection.countDocuments({ buyerEmail: email, status: "bought" });

    // Pending offers
    const pendingOffersCount = await offersCollection.countDocuments({ buyerEmail: email, status: "pending" });

    // My reviews
    const reviewsCount = await reviewsCollection.countDocuments({ userEmail: email });

    res.json({
      wishlistCount,
      boughtCount,
      pendingOffersCount,
      reviewsCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
    // Get all verified properties (with search and sort)
    app.get("/properties", async (req, res) => {
      try {
        const { location = "", sort = "" } = req.query;
        const query = { status: "Verified" };
        if (location) {
          query.location = { $regex: location, $options: "i" };
        }
        let properties = await propertiesCollection.find(query).toArray();
        if (sort === "asc" || sort === "desc") {
          properties = properties.sort((a, b) => {
            const getPrice = (priceRange) => {
              if (!isNaN(priceRange)) return Number(priceRange);
              const prices = priceRange.split("-").map(Number);
              return prices[0];
            };
            const aPrice = getPrice(a.priceRange);
            const bPrice = getPrice(b.priceRange);
            return sort === "asc" ? aPrice - bPrice : bPrice - aPrice;
          });
        }
        const agentEmails = properties.map((p) => p.agentEmail);
        const agents = await usersCollection
          .find({ email: { $in: agentEmails } })
          .toArray();
        const propertiesWithAgentImage = properties.map((property) => {
          const agent = agents.find((a) => a.email === property.agentEmail);
          return {
            ...property,
            agentImage:
              agent?.image || "https://i.ibb.co/2d9dK0F/default-profile.png",
          };
        });
        res.status(200).json(propertiesWithAgentImage);
      } catch (err) {
        res.status(500).json({ message: "Failed to fetch properties" });
      }
    });

    // Get property details by ID
    app.get("/property-details/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!property)
          return res.status(404).send({ message: "Property not found" });
        const agent = await usersCollection.findOne({
          email: property.agentEmail,
        });
        property.agentImage =
          agent?.image || "https://i.ibb.co/2d9dK0F/default-profile.png";
        res.send(property);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch property details" });
      }
    });

    // Add property (agent only)
    app.post(
      "/add-property",
      verifyFirebaseToken,
      verifyAgent,
      async (req, res) => {
        try {
          const { agentEmail } = req.body;
          const agent = await usersCollection.findOne({ email: agentEmail });
          if (agent?.isFraud) {
            return res
              .status(403)
              .send({ message: "Fraud agents cannot add properties." });
          }
          const result = await propertiesCollection.insertOne(req.body);
          res.send({ acknowledged: true, insertedId: result.insertedId });
        } catch (err) {
          res
            .status(500)
            .send({ acknowledged: false, message: "Failed to add property" });
        }
      }
    );

    // Wishlist
    app.post("/wishlist", verifyFirebaseToken, async (req, res) => {
      try {
        const { userEmail, propertyId } = req.body;
        const exists = await wishlistCollection.findOne({
          userEmail,
          propertyId: new ObjectId(propertyId),
        });
        if (exists)
          return res.status(409).send({ message: "Already in wishlist" });
        const result = await wishlistCollection.insertOne({
          userEmail,
          propertyId: new ObjectId(propertyId),
          addedAt: new Date().toISOString(),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to add to wishlist" });
      }
    });

    app.get("/wishlist/:userEmail", verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.params.userEmail;
        const wishlistItems = await wishlistCollection
          .find({ userEmail })
          .toArray();
        const propertyIds = wishlistItems.map((item) => item.propertyId);
        const properties = await propertiesCollection
          .find({ _id: { $in: propertyIds } })
          .toArray();
        const agentEmails = properties.map((p) => p.agentEmail);
        const agents = await usersCollection
          .find({ email: { $in: agentEmails } })
          .toArray();
        const propertiesWithAgentImage = properties.map((property) => {
          const agent = agents.find((a) => a.email === property.agentEmail);
          return {
            ...property,
            agentImage:
              agent?.image || "https://i.ibb.co/2d9dK0F/default-profile.png",
          };
        });
        res.send(propertiesWithAgentImage);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch wishlist" });
      }
    });

    app.delete("/wishlist", verifyFirebaseToken, async (req, res) => {
      try {
        const { userEmail, propertyId } = req.body;
        const result = await wishlistCollection.deleteOne({
          userEmail,
          propertyId: new ObjectId(propertyId),
        });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to remove from wishlist" });
      }
    });

    // Reviews
    app.get("/reviews/:propertyId", async (req, res) => {
      try {
        const propertyId = req.params.propertyId;
        const reviews = await reviewsCollection
          .find({ propertyId: new ObjectId(propertyId) })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      try {
        const { propertyId, userEmail, userName, userImage, rating, comment } =
          req.body;
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(propertyId),
        });
        const review = {
          propertyId: new ObjectId(propertyId),
          propertyTitle: property?.title || "",
          agentName: property?.agentName || "",
          userEmail,
          userName,
          userImage,
          rating,
          comment,
          createdAt: new Date().toISOString(),
        };
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to add review" });
      }
    });

    app.get("/my-reviews/:userEmail", verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.params.userEmail;
        const reviews = await reviewsCollection
          .find({ userEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    app.delete(
      "/my-reviews/:reviewId",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const reviewId = req.params.reviewId;
          const result = await reviewsCollection.deleteOne({
            _id: new ObjectId(reviewId),
          });
          res.send(result);
        } catch (err) {
          res.status(500).send({ message: "Failed to delete review" });
        }
      }
    );

    // Offers
    app.post("/offers", verifyFirebaseToken, async (req, res) => {
      try {
        const { propertyId, offerAmount, buyerEmail, buyerName, buyingDate } =
          req.body;
        const user = await usersCollection.findOne({ email: buyerEmail });
        if (!user || user.role !== "customer") {
          return res
            .status(403)
            .send({ message: "Only customers can make an offer." });
        }
        const property = await propertiesCollection.findOne({
          _id: new ObjectId(propertyId),
        });
        if (!property) {
          return res.status(404).send({ message: "Property not found." });
        }
        const [min, max] = property.priceRange.split("-").map(Number);
        if (offerAmount < min || offerAmount > max) {
          return res
            .status(400)
            .send({ message: `Offer must be between ${min} and ${max}` });
        }
        const existingOffer = await offersCollection.findOne({
          propertyId: new ObjectId(propertyId),
          buyerEmail,
        });
        if (existingOffer) {
          return res.status(409).send({
            message: "You have already made an offer for this property.",
          });
        }
        const offer = {
          propertyId: new ObjectId(propertyId),
          propertyTitle: property.title,
          propertyLocation: property.location,
          propertyImage: property.imageUrl,
          agentName: property.agentName,
          agentEmail: property.agentEmail,
          offerAmount,
          buyerEmail,
          buyerName,
          buyingDate,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        const result = await offersCollection.insertOne(offer);
        res.send({ acknowledged: true, insertedId: result.insertedId });
      } catch (err) {
        res.status(500).send({ message: "Failed to make offer" });
      }
    });

    app.get("/offers/:buyerEmail", verifyFirebaseToken, async (req, res) => {
      try {
        const buyerEmail = req.params.buyerEmail;
        const offers = await offersCollection
          .find({ buyerEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(offers);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch offers" });
      }
    });

    // Stripe Payment
    app.post(
      "/create-payment-intent",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { offerId } = req.body;
          const offer = await offersCollection.findOne({
            _id: new ObjectId(offerId),
          });
          if (!offer)
            return res.status(404).send({ message: "Offer not found" });
          const amount = Number(offer.offerAmount);
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            metadata: { offerId: offerId },
          });
          res.send({ clientSecret: paymentIntent.client_secret });
        } catch (err) {
          res.status(500).send({ message: "Failed to create payment intent" });
        }
      }
    );

    app.patch(
      "/offers/payment/:offerId",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { transactionId } = req.body;
          const offerId = req.params.offerId;
          const result = await offersCollection.updateOne(
            { _id: new ObjectId(offerId) },
            { $set: { status: "bought", transactionId } }
          );
          res.send(result);
        } catch (err) {
          res
            .status(500)
            .send({ message: "Failed to update offer after payment" });
        }
      }
    );

    // Reports
    app.post("/reports", verifyFirebaseToken, async (req, res) => {
      try {
        const {
          propertyId,
          propertyTitle,
          agentName,
          reporterName,
          reporterEmail,
          description,
        } = req.body;
        const report = {
          propertyId,
          propertyTitle,
          agentName,
          reporterName,
          reporterEmail,
          description,
          createdAt: new Date().toISOString(),
        };
        const result = await reportsCollection.insertOne(report);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to submit report" });
      }
    });

    // User registration/login (upsert)
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.role = "customer";
      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.name = userData.name || "Anonymous";
      userData.image =
        userData.image || "https://i.ibb.co/2d9dK0F/default-profile.png";
      const query = { email: userData?.email };
      const alreadyExists = await usersCollection.findOne(query);
      if (!!alreadyExists) {
        const result = await usersCollection.updateOne(query, {
          $set: { last_loggedIn: new Date().toISOString() },
        });
        return res.send(result);
      }
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    // Get a user's role
    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      if (!result) return res.status(404).send({ message: "User Not Found." });
      res.send({ role: result?.role });
    });

    // Advertised properties (public)
    app.get("/advertised-properties", async (req, res) => {
      try {
        const properties = await propertiesCollection
          .find({ isAdvertised: true, status: "Verified" })
          .limit(4)
          .toArray();
        res.send(properties);
      } catch (err) {
        res
          .status(500)
          .send({ message: "Failed to fetch advertised properties" });
      }
    });

    // Latest reviews (public)
    app.get("/latest-reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({})
          .sort({ createdAt: -1 })
          .limit(3)
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch latest reviews" });
      }
    });

    // Home route
    app.get("/", (req, res) => {
      res.send("Hello from PropertyPulse Server..");
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`PropertyPulse is running on port ${port}`);
});
