// Neural Context Engine - The brain behind Maily Matrix
export interface EmailContext {
    id: string
    sender: string
    subject: string
    content: string
    timestamp: Date
    threadId?: string
    attachments?: string[]
}

export interface RelationshipMap {
    email: string
    name: string
    company?: string
    role?: string
    influence: number // 0-100
    relationshipStrength: number // 0-100
    lastInteraction: Date
    interactionHistory: EmailContext[]
    networkConnections: string[] // other emails they're connected to
    valueGenerated: number // total revenue/value from this relationship
    responsePatterns: {
        averageResponseTime: number // hours
        responseRate: number // 0-100
        preferredCommunicationStyle: string
    }
}

export interface OpportunitySignal {
    id: string
    type: 'revenue' | 'partnership' | 'risk' | 'network' | 'intelligence'
    confidence: number // 0-100
    estimatedValue: number // potential revenue value
    timeSensitivity: number // 0-100
    requiredAction: string
    predictedOutcome: string
    riskFactors: string[]
    successFactors: string[]
    deadline?: Date
    dependencies: string[] // other emails/tasks this depends on
}

export interface NetworkAnalysis {
    nodes: RelationshipMap[]
    edges: Array<{
        from: string
        to: string
        strength: number
        type: 'professional' | 'personal' | 'customer' | 'partner' | 'investor'
        lastInteraction: Date
    }>
    clusters: Array<{
        id: string
        name: string
        members: string[]
        influence: number
        opportunityDensity: number
    }>
    networkValue: number
    growthPotential: number
}

export class NeuralContextEngine {
    private relationships: Map<string, RelationshipMap> = new Map()
    private opportunities: Map<string, OpportunitySignal> = new Map()
    private networkAnalysis: NetworkAnalysis | null = null

    // Core intelligence methods
    async analyzeEmail(email: EmailContext): Promise<{
        relationshipContext: RelationshipMap
        opportunitySignals: OpportunitySignal[]
        networkEffects: string[]
        predictedOutcomes: string[]
    }> {
        const relationshipContext = await this.updateRelationshipContext(email)
        const opportunitySignals = await this.detectOpportunities(email)
        const networkEffects = await this.analyzeNetworkEffects(email)
        const predictedOutcomes = await this.predictOutcomes(email, opportunitySignals)

        return {
            relationshipContext,
            opportunitySignals,
            networkEffects,
            predictedOutcomes
        }
    }

    private async updateRelationshipContext(email: EmailContext): Promise<RelationshipMap> {
        const existing = this.relationships.get(email.sender) || {
            email: email.sender,
            name: this.extractName(email.sender),
            influence: this.calculateInfluence(email.sender),
            relationshipStrength: 0,
            lastInteraction: email.timestamp,
            interactionHistory: [],
            networkConnections: [],
            valueGenerated: 0,
            responsePatterns: {
                averageResponseTime: 0,
                responseRate: 0,
                preferredCommunicationStyle: 'professional'
            }
        }

        // Update relationship data
        existing.interactionHistory.push(email)
        existing.lastInteraction = email.timestamp
        existing.relationshipStrength = this.calculateRelationshipStrength(existing)
        existing.valueGenerated = this.calculateValueGenerated(existing)
        existing.responsePatterns = await this.analyzeResponsePatterns(existing)

        this.relationships.set(email.sender, existing)
        return existing
    }

    private async detectOpportunities(email: EmailContext): Promise<OpportunitySignal[]> {
        const signals: OpportunitySignal[] = []
        
        // Revenue opportunity detection
        const revenueSignals = await this.detectRevenueOpportunities(email)
        signals.push(...revenueSignals)

        // Partnership opportunity detection
        const partnershipSignals = await this.detectPartnershipOpportunities(email)
        signals.push(...partnershipSignals)

        // Risk detection
        const riskSignals = await this.detectRisks(email)
        signals.push(...riskSignals)

        // Network opportunity detection
        const networkSignals = await this.detectNetworkOpportunities(email)
        signals.push(...networkSignals)

        // Store opportunities
        signals.forEach(signal => this.opportunities.set(signal.id, signal))
        
        return signals
    }

    private async detectRevenueOpportunities(email: EmailContext): Promise<OpportunitySignal[]> {
        const signals: OpportunitySignal[] = []
        const content = email.content.toLowerCase()
        const subject = email.subject.toLowerCase()

        // Revenue keywords and patterns
        const revenueKeywords = [
            'buy', 'purchase', 'contract', 'deal', 'proposal', 'quote', 'pricing',
            'enterprise', 'annual contract', 'subscription', 'license', 'payment',
            'invoice', 'budget', 'investment', 'cost', 'price'
        ]

        const hasRevenueKeywords = revenueKeywords.some(keyword => 
            content.includes(keyword) || subject.includes(keyword)
        )

        if (hasRevenueKeywords) {
            const estimatedValue = this.extractMonetaryValue(email)
            const confidence = this.calculateRevenueConfidence(email)
            
            signals.push({
                id: `revenue-${email.id}`,
                type: 'revenue',
                confidence,
                estimatedValue,
                timeSensitivity: this.calculateTimeSensitivity(email),
                requiredAction: this.suggestRevenueAction(email),
                predictedOutcome: this.predictRevenueOutcome(email, estimatedValue),
                riskFactors: this.identifyRevenueRisks(email),
                successFactors: this.identifyRevenueSuccessFactors(email),
                dependencies: this.identifyDependencies(email)
            })
        }

        return signals
    }

    private async detectPartnershipOpportunities(email: EmailContext): Promise<OpportunitySignal[]> {
        const signals: OpportunitySignal[] = []
        const content = email.content.toLowerCase()
        const subject = email.subject.toLowerCase()

        const partnershipKeywords = [
            'partnership', 'collaborate', 'joint venture', 'strategic alliance',
            'integration', 'api', 'co-marketing', 'referral', 'affiliate',
            'channel partner', 'technology partner', 'reseller'
        ]

        const hasPartnershipKeywords = partnershipKeywords.some(keyword => 
            content.includes(keyword) || subject.includes(keyword)
        )

        if (hasPartnershipKeywords) {
            signals.push({
                id: `partnership-${email.id}`,
                type: 'partnership',
                confidence: this.calculatePartnershipConfidence(email),
                estimatedValue: this.estimatePartnershipValue(email),
                timeSensitivity: this.calculateTimeSensitivity(email),
                requiredAction: 'Schedule partnership discussion',
                predictedOutcome: this.predictPartnershipOutcome(email),
                riskFactors: this.identifyPartnershipRisks(email),
                successFactors: this.identifyPartnershipSuccessFactors(email),
                dependencies: this.identifyDependencies(email)
            })
        }

        return signals
    }

    private async detectRisks(email: EmailContext): Promise<OpportunitySignal[]> {
        const signals: OpportunitySignal[] = []
        const content = email.content.toLowerCase()
        const subject = email.subject.toLowerCase()

        const riskKeywords = [
            'urgent', 'problem', 'issue', 'complaint', 'cancel', 'legal',
            'lawsuit', 'violation', 'breach', 'terminate', 'dispute',
            'concern', 'warning', 'alert', 'critical', 'emergency'
        ]

        const hasRiskKeywords = riskKeywords.some(keyword => 
            content.includes(keyword) || subject.includes(keyword)
        )

        if (hasRiskKeywords) {
            signals.push({
                id: `risk-${email.id}`,
                type: 'risk',
                confidence: this.calculateRiskConfidence(email),
                estimatedValue: -this.estimateRiskImpact(email), // negative value for risk
                timeSensitivity: 95, // risks are typically time-sensitive
                requiredAction: this.suggestRiskAction(email),
                predictedOutcome: this.predictRiskOutcome(email),
                riskFactors: this.identifyRiskFactors(email),
                successFactors: ['Immediate response', 'Proactive communication'],
                deadline: this.estimateRiskDeadline(email),
                dependencies: this.identifyDependencies(email)
            })
        }

        return signals
    }

    private async detectNetworkOpportunities(email: EmailContext): Promise<OpportunitySignal[]> {
        const signals: OpportunitySignal[] = []
        const content = email.content.toLowerCase()
        const subject = email.subject.toLowerCase()

        const networkKeywords = [
            'introduction', 'referral', 'recommend', 'connect', 'introduce',
            'network', 'contact', 'warm intro', 'meet', 'community', 'group'
        ]

        const hasNetworkKeywords = networkKeywords.some(keyword => 
            content.includes(keyword) || subject.includes(keyword)
        )

        if (hasNetworkKeywords) {
            signals.push({
                id: `network-${email.id}`,
                type: 'network',
                confidence: this.calculateNetworkConfidence(email),
                estimatedValue: this.estimateNetworkValue(email),
                timeSensitivity: this.calculateTimeSensitivity(email),
                requiredAction: 'Accept network opportunity',
                predictedOutcome: this.predictNetworkOutcome(email),
                riskFactors: this.identifyNetworkRisks(email),
                successFactors: this.identifyNetworkSuccessFactors(email),
                dependencies: []
            })
        }

        return signals
    }

    // Helper methods for analysis
    private extractName(email: string): string {
        const parts = email.split('@')[0].split('.')
        return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    }

    private calculateInfluence(email: string): number {
        // Influence based on domain, company, role detection
        const domain = email.split('@')[1]
        
        // High influence domains
        const highInfluenceDomains = ['fortune500.com', 'google.com', 'microsoft.com', 'amazon.com']
        if (highInfluenceDomains.some(d => domain.includes(d))) return 85
        
        // Medium influence domains
        const mediumInfluenceDomains = ['vc.com', 'startup.com', 'tech.com']
        if (mediumInfluenceDomains.some(d => domain.includes(d))) return 65
        
        return 50
    }

    private calculateRelationshipStrength(relationship: RelationshipMap): number {
        const interactionCount = relationship.interactionHistory.length
        const recency = this.calculateRecency(relationship.lastInteraction)
        const responseRate = relationship.responsePatterns.responseRate
        
        return Math.min(100, (interactionCount * 5) + recency + responseRate)
    }

    private calculateRecency(lastInteraction: Date): number {
        const hoursSince = (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60)
        return Math.max(0, 100 - hoursSince)
    }

    private calculateValueGenerated(relationship: RelationshipMap): number {
        // Sum of all revenue-generating interactions
        return relationship.interactionHistory
            .filter(email => this.isRevenueGenerating(email))
            .reduce((sum, email) => sum + this.extractMonetaryValue(email), 0)
    }

    private async analyzeResponsePatterns(relationship: RelationshipMap): Promise<{
        averageResponseTime: number
        responseRate: number
        preferredCommunicationStyle: string
    }> {
        const interactions = relationship.interactionHistory
        
        // Calculate average response time
        const responseTimes = this.calculateResponseTimes(interactions)
        const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        
        // Calculate response rate
        const responseRate = (responseTimes.length / interactions.length) * 100
        
        // Determine communication style
        const style = this.determineCommunicationStyle(interactions)
        
        return {
            averageResponseTime,
            responseRate,
            preferredCommunicationStyle: style
        }
    }

    private extractMonetaryValue(email: EmailContext): number {
        const content = (email.subject + ' ' + email.content).toLowerCase()
        const moneyPattern = /\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/g
        const matches = content.match(moneyPattern)
        
        if (!matches) return 0
        
        return matches.reduce((sum, match) => {
            const value = parseFloat(match.replace(/[$,]/g, ''))
            return sum + value
        }, 0)
    }

    private calculateRevenueConfidence(email: EmailContext): number {
        let confidence = 50
        
        // Increase confidence based on keywords
        const strongKeywords = ['contract', 'proposal', 'quote', 'pricing']
        const content = (email.subject + ' ' + email.content).toLowerCase()
        
        strongKeywords.forEach(keyword => {
            if (content.includes(keyword)) confidence += 15
        })
        
        return Math.min(100, confidence)
    }

    private calculateTimeSensitivity(email: EmailContext): number {
        const content = (email.subject + ' ' + email.content).toLowerCase()
        
        if (content.includes('urgent') || content.includes('asap')) return 95
        if (content.includes('deadline') || content.includes('expir')) return 85
        if (content.includes('soon') || content.includes('quick')) return 70
        
        return 50
    }

    private suggestRevenueAction(email: EmailContext): string {
        const value = this.extractMonetaryValue(email)
        if (value > 50000) return 'Schedule executive call'
        if (value > 10000) return 'Prepare detailed proposal'
        return 'Send pricing information'
    }

    private predictRevenueOutcome(email: EmailContext, value: number): string {
        const confidence = this.calculateRevenueConfidence(email)
        return `${confidence}% chance of closing ${value > 0 ? '$' + value.toLocaleString() : 'deal'}`
    }

    // Additional helper methods would be implemented here...
    private identifyRevenueRisks(email: EmailContext): string[] {
        return ['Competitor involvement', 'Budget constraints', 'Timeline conflicts']
    }

    private identifyRevenueSuccessFactors(email: EmailContext): string[] {
        return ['Strong relationship', 'Clear value proposition', 'Competitive pricing']
    }

    private identifyDependencies(email: EmailContext): string[] {
        return ['Legal review', 'Technical assessment', 'Budget approval']
    }

    private isRevenueGenerating(email: EmailContext): boolean {
        return this.calculateRevenueConfidence(email) > 60
    }

    private calculateResponseTimes(interactions: EmailContext[]): number[] {
        // Implementation would calculate actual response times
        return [2, 4, 1, 3] // hours
    }

    private determineCommunicationStyle(interactions: EmailContext[]): string {
        return 'professional'
    }

    private calculatePartnershipConfidence(email: EmailContext): number { return 75 }
    private estimatePartnershipValue(email: EmailContext): number { return 25000 }
    private predictPartnershipOutcome(email: EmailContext): string { return 'High potential for strategic growth' }
    private identifyPartnershipRisks(email: EmailContext): string[] { return ['Resource allocation', 'Brand alignment'] }
    private identifyPartnershipSuccessFactors(email: EmailContext): string[] { return ['Shared vision', 'Complementary strengths'] }

    private calculateRiskConfidence(email: EmailContext): number { return 85 }
    private estimateRiskImpact(email: EmailContext): number { return 10000 }
    private suggestRiskAction(email: EmailContext): string { return 'Immediate response required' }
    private predictRiskOutcome(email: EmailContext): string { return 'Potential loss if not addressed' }
    private identifyRiskFactors(email: EmailContext): string[] { return ['Customer satisfaction', 'Legal compliance'] }
    private estimateRiskDeadline(email: EmailContext): Date { return new Date(Date.now() + 24 * 60 * 60 * 1000) }

    private calculateNetworkConfidence(email: EmailContext): number { return 80 }
    private estimateNetworkValue(email: EmailContext): number { return 15000 }
    private predictNetworkOutcome(email: EmailContext): string { return 'Network expansion opportunity' }
    private identifyNetworkRisks(email: EmailContext): string[] { return ['Time commitment', 'Reputation risk'] }
    private identifyNetworkSuccessFactors(email: EmailContext): string[] { return ['Mutual benefit', 'Strong connections'] }

    private async analyzeNetworkEffects(email: EmailContext): Promise<string[]> {
        return ['Network expansion', 'Referral potential', 'Influence increase']
    }

    private async predictOutcomes(email: EmailContext, opportunities: OpportunitySignal[]): Promise<string[]> {
        return opportunities.map(opp => opp.predictedOutcome)
    }
}

// Singleton instance
export const neuralContextEngine = new NeuralContextEngine()
