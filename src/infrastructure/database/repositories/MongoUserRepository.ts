import { User } from '../../../domain/entities/User';
import { IUserRepository } from '../../../domain/ports/ports';
import { UserModel } from '../models/UserModel';

function toEntity(doc: any): User {
  return {
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    machineIdCreated: doc.machineIdCreated,
    passwordHash: doc.passwordHash,
    isPremium: doc.isPremium,
    premiumExpiry: doc.premiumExpiry,
    trialDaysLeft: doc.trialDaysLeft,
    trialDurationDays: doc.trialDurationDays ?? 7,
    trialStartedAt: doc.trialStartedAt,
    payPhonePendingClientTransactionId: doc.payPhonePendingClientTransactionId,
    payPhonePendingPlanKey: doc.payPhonePendingPlanKey,
    payPhonePendingPremiumDays: doc.payPhonePendingPremiumDays,
    payPhonePendingCreatedAt: doc.payPhonePendingCreatedAt,
    payPhoneLastTransactionId: doc.payPhoneLastTransactionId,
    payPhoneLastClientTransactionId: doc.payPhoneLastClientTransactionId,
    payPhoneLastPaymentStatus: doc.payPhoneLastPaymentStatus,
    payPhoneLastPaymentUpdatedAt: doc.payPhoneLastPaymentUpdatedAt,
    payPhonePaymentToken: doc.payPhonePaymentToken,
    activeSessions: doc.activeSessions ?? [],
    emailVerified: doc.emailVerified,
    emailVerifyToken: doc.emailVerifyToken,
    passwordResetToken: doc.passwordResetToken,
    passwordResetExpiry: doc.passwordResetExpiry,
    isActive: doc.isActive,
    deactivatedAt: doc.deactivatedAt,
    deactivatedReason: doc.deactivatedReason,
    accountDeletionRequest: doc.accountDeletionRequest,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoUserRepository implements IUserRepository {
  async findById(id: string): Promise<User | null> {
    const doc = await UserModel.findById(id).lean();
    return doc ? toEntity(doc) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).lean();
    return doc ? toEntity(doc) : null;
  }

  async findByEmailVerifyToken(token: string): Promise<User | null> {
    const doc = await UserModel.findOne({ emailVerifyToken: token }).lean();
    return doc ? toEntity(doc) : null;
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    const doc = await UserModel.findOne({ passwordResetToken: token }).lean();
    return doc ? toEntity(doc) : null;
  }

  async findByPayPhonePendingClientTransactionId(clientTransactionId: string): Promise<User | null> {
    const doc = await UserModel.findOne({
      payPhonePendingClientTransactionId: clientTransactionId,
    }).lean();
    return doc ? toEntity(doc) : null;
  }

  async save(user: User): Promise<User> {
    const doc = await UserModel.findByIdAndUpdate(
      user.id,
      { $set: user },
      { new: true, upsert: true },
    ).lean();

    return toEntity(doc);
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const doc = await UserModel.create(data);
    return toEntity(doc.toObject());
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    const doc = await UserModel.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
    return doc ? toEntity(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await UserModel.findByIdAndDelete(id);
    return Boolean(result);
  }

  async countAll(): Promise<number> {
    return UserModel.countDocuments();
  }

  async findAll(skip = 0, limit = 20): Promise<User[]> {
    const docs = await UserModel.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return docs.map(toEntity);
  }
  async countByMachineId(machineId: string): Promise<number> {
    return UserModel.countDocuments({ machineIdCreated: machineId, isActive: true });
  }
  
  async findAllByMachineId(machineId: string): Promise<User[]> {
    const docs = await UserModel.find({ machineIdCreated: machineId }).lean();
    return docs.map(toEntity);
  }
}
