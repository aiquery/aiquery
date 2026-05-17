import React, { useState } from 'react'
import { useDraggableResizable } from '../hooks/useDraggableResizable'
import './PaymentModal.css'

interface PaymentModalProps {
  planName: string
  planType: string
  amount: number
  onClose: () => void
  onPaymentComplete: (paymentMethod: string, paymentDetails: any) => void
}

const PaymentModal: React.FC<PaymentModalProps> = ({ 
  planName, 
  planType, 
  amount, 
  onClose, 
  onPaymentComplete 
}) => {
  const { modalRef, position, modalSize, isDragging, handleMouseDown, handleResizeStart } = useDraggableResizable({
    initialWidth: 600,
    initialHeight: 700,
    minWidth: 500,
    minHeight: 500,
    storageKey: 'paymentModal'
  })
  
  const [selectedMethod, setSelectedMethod] = useState<'creditcard' | 'etransfer' | null>(null)
  const [creditCardInfo, setCreditCardInfo] = useState({
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    cardholderName: ''
  })
  const [processing, setProcessing] = useState(false)
  const [cardErrors, setCardErrors] = useState({
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    cardholderName: ''
  })

  const getPlanDisplayName = (name: string) => {
    const names: Record<string, string> = {
      free: 'Free Try',
      startpro: 'StartPro',
      smartpro: 'SmartPro',
      enterprise: 'Enterprise'
    }
    return names[name] || name
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  // Calculate GCT tax (5%) and total amount
  const planFee = amount
  const gctTax = planFee * 0.05
  const totalAmount = planFee + gctTax

  const handlePayment = async () => {
    if (!selectedMethod) {
      alert('Please select a payment method')
      return
    }

    setProcessing(true)

    try {
      let paymentDetails: any = {}

      if (selectedMethod === 'creditcard') {
        // Validate credit card info - check if all fields are filled
        if (!creditCardInfo.cardNumber || !creditCardInfo.expiryDate || !creditCardInfo.cvv || !creditCardInfo.cardholderName) {
          alert('Please fill in all credit card information')
          setProcessing(false)
          return
        }

        // Validate credit card number using Luhn algorithm
        if (!validateCreditCard(creditCardInfo.cardNumber)) {
          alert('Invalid credit card number. Please check and try again.')
          setProcessing(false)
          return
        }

        // Validate expiry date
        if (!validateExpiryDate(creditCardInfo.expiryDate)) {
          alert('Invalid expiry date. Please enter a valid future date (MM/YY).')
          setProcessing(false)
          return
        }

        // Validate CVV
        if (!validateCVV(creditCardInfo.cvv)) {
          alert('Invalid CVV. Please enter a 3 or 4 digit CVV.')
          setProcessing(false)
          return
        }

        // Validate cardholder name
        if (creditCardInfo.cardholderName.trim().length < 2) {
          alert('Please enter a valid cardholder name.')
          setProcessing(false)
          return
        }

        paymentDetails = {
          method: 'creditcard',
          cardNumber: creditCardInfo.cardNumber.replace(/\s/g, ''),
          expiryDate: creditCardInfo.expiryDate,
          cvv: creditCardInfo.cvv,
          cardholderName: creditCardInfo.cardholderName.trim()
        }
      } else if (selectedMethod === 'etransfer') {
        paymentDetails = {
          method: 'etransfer',
          email: 'sales@gmail.com'
        }
      }

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 1500))

      // Call the payment complete callback
      onPaymentComplete(selectedMethod, paymentDetails)
    } catch (error) {
      console.error('Payment error:', error)
      alert('Payment processing failed. Please try again.')
      setProcessing(false)
    }
  }

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '')
    const matches = v.match(/\d{4,16}/g)
    const match = matches && matches[0] || ''
    const parts = []
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4))
    }
    if (parts.length) {
      return parts.join(' ')
    } else {
      return v
    }
  }

  const formatExpiryDate = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '')
    if (v.length >= 2) {
      return v.substring(0, 2) + '/' + v.substring(2, 4)
    }
    return v
  }

  // Luhn algorithm for credit card validation
  const validateCreditCard = (cardNumber: string): boolean => {
    // Remove spaces and non-digits
    const cleaned = cardNumber.replace(/\s+/g, '').replace(/[^0-9]/gi, '')
    
    // Check if it's all digits and has valid length (13-19 digits)
    if (!/^\d{13,19}$/.test(cleaned)) {
      return false
    }

    // Luhn algorithm
    let sum = 0
    let isEven = false

    // Start from the rightmost digit
    for (let i = cleaned.length - 1; i >= 0; i--) {
      let digit = parseInt(cleaned[i])

      if (isEven) {
        digit *= 2
        if (digit > 9) {
          digit -= 9
        }
      }

      sum += digit
      isEven = !isEven
    }

    return sum % 10 === 0
  }

  // Validate expiry date (MM/YY format)
  const validateExpiryDate = (expiryDate: string): boolean => {
    if (!/^\d{2}\/\d{2}$/.test(expiryDate)) {
      return false
    }

    const [month, year] = expiryDate.split('/').map(Number)
    const currentDate = new Date()
    const currentYear = currentDate.getFullYear() % 100
    const currentMonth = currentDate.getMonth() + 1

    // Check if month is valid (1-12)
    if (month < 1 || month > 12) {
      return false
    }

    // Check if expiry date is in the future
    if (year < currentYear || (year === currentYear && month < currentMonth)) {
      return false
    }

    return true
  }

  // Validate CVV (3-4 digits)
  const validateCVV = (cvv: string): boolean => {
    return /^\d{3,4}$/.test(cvv)
  }

  return (
    <div className="payment-modal-overlay" onClick={onClose}>
      <div 
        ref={modalRef}
        className="payment-modal draggable-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${modalSize.width}px`,
          height: `${modalSize.height}px`,
          cursor: isDragging ? 'grabbing' : 'default'
        }}
      >
        <div 
          className="payment-modal-header"
          onMouseDown={handleMouseDown}
          style={{ cursor: 'grab' }}
        >
          <h2>Payment Information</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="payment-modal-content">
          <div className="payment-summary">
            <h3>Order Summary</h3>
            <div className="summary-item">
              <span className="summary-label">Plan:</span>
              <span className="summary-value">{getPlanDisplayName(planName)} ({planType === 'annual' ? 'Annual' : 'Monthly'})</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Plan fee:</span>
              <span className="summary-value">{formatCurrency(planFee)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">GCT tax (5%):</span>
              <span className="summary-value">{formatCurrency(gctTax)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total amount:</span>
              <span className="summary-value amount">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          <div className="payment-methods">
            <h3>Select Payment Method</h3>
            
            {/* Credit Card Option */}
            <div 
              className={`payment-method-option ${selectedMethod === 'creditcard' ? 'selected' : ''}`}
              onClick={() => setSelectedMethod('creditcard')}
            >
              <div className="method-header">
                <input 
                  type="radio" 
                  name="paymentMethod" 
                  checked={selectedMethod === 'creditcard'}
                  onChange={() => setSelectedMethod('creditcard')}
                />
                <span className="method-icon">💳</span>
                <span className="method-name">Credit Card</span>
              </div>
              {selectedMethod === 'creditcard' && (
                <div className="method-form">
                  <div className="form-group">
                    <label>Cardholder Name</label>
                    <input
                      type="text"
                      placeholder="John Doe"
                      value={creditCardInfo.cardholderName}
                      onChange={(e) => setCreditCardInfo({ ...creditCardInfo, cardholderName: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Card Number</label>
                    <input
                      type="text"
                      placeholder="1234 5678 9012 3456"
                      maxLength={19}
                      value={creditCardInfo.cardNumber}
                      onChange={(e) => {
                        const formatted = formatCardNumber(e.target.value)
                        setCreditCardInfo({ ...creditCardInfo, cardNumber: formatted })
                        // Validate on change if card number is complete
                        if (formatted.replace(/\s/g, '').length >= 13) {
                          const isValid = validateCreditCard(formatted)
                          setCardErrors({
                            ...cardErrors,
                            cardNumber: isValid ? '' : 'Invalid card number'
                          })
                        } else {
                          setCardErrors({ ...cardErrors, cardNumber: '' })
                        }
                      }}
                      onBlur={() => {
                        if (creditCardInfo.cardNumber) {
                          const isValid = validateCreditCard(creditCardInfo.cardNumber)
                          setCardErrors({
                            ...cardErrors,
                            cardNumber: isValid ? '' : 'Invalid card number'
                          })
                        }
                      }}
                    />
                    {cardErrors.cardNumber && (
                      <span className="error-message">{cardErrors.cardNumber}</span>
                    )}
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Expiry Date</label>
                      <input
                        type="text"
                        placeholder="MM/YY"
                        maxLength={5}
                        value={creditCardInfo.expiryDate}
                        onChange={(e) => {
                          const formatted = formatExpiryDate(e.target.value)
                          setCreditCardInfo({ ...creditCardInfo, expiryDate: formatted })
                          // Validate on change if expiry date is complete
                          if (formatted.length === 5) {
                            const isValid = validateExpiryDate(formatted)
                            setCardErrors({
                              ...cardErrors,
                              expiryDate: isValid ? '' : 'Invalid or expired date'
                            })
                          } else {
                            setCardErrors({ ...cardErrors, expiryDate: '' })
                          }
                        }}
                        onBlur={() => {
                          if (creditCardInfo.expiryDate) {
                            const isValid = validateExpiryDate(creditCardInfo.expiryDate)
                            setCardErrors({
                              ...cardErrors,
                              expiryDate: isValid ? '' : 'Invalid or expired date'
                            })
                          }
                        }}
                      />
                      {cardErrors.expiryDate && (
                        <span className="error-message">{cardErrors.expiryDate}</span>
                      )}
                    </div>
                    <div className="form-group">
                      <label>CVV</label>
                      <input
                        type="text"
                        placeholder="123"
                        maxLength={4}
                        value={creditCardInfo.cvv}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/\D/g, '')
                          setCreditCardInfo({ ...creditCardInfo, cvv: cleaned })
                          // Validate on change if CVV is complete
                          if (cleaned.length >= 3) {
                            const isValid = validateCVV(cleaned)
                            setCardErrors({
                              ...cardErrors,
                              cvv: isValid ? '' : 'Invalid CVV'
                            })
                          } else {
                            setCardErrors({ ...cardErrors, cvv: '' })
                          }
                        }}
                        onBlur={() => {
                          if (creditCardInfo.cvv) {
                            const isValid = validateCVV(creditCardInfo.cvv)
                            setCardErrors({
                              ...cardErrors,
                              cvv: isValid ? '' : 'Invalid CVV'
                            })
                          }
                        }}
                      />
                      {cardErrors.cvv && (
                        <span className="error-message">{cardErrors.cvv}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* E-Transfer Option */}
            <div 
              className={`payment-method-option ${selectedMethod === 'etransfer' ? 'selected' : ''}`}
              onClick={() => setSelectedMethod('etransfer')}
            >
              <div className="method-header">
                <input 
                  type="radio" 
                  name="paymentMethod" 
                  checked={selectedMethod === 'etransfer'}
                  onChange={() => setSelectedMethod('etransfer')}
                />
                <span className="method-icon">📧</span>
                <span className="method-name">Email E-Transfer</span>
              </div>
              {selectedMethod === 'etransfer' && (
                <div className="method-form">
                  <div className="etransfer-info">
                    <p>Please send an e-transfer to:</p>
                    <div className="etransfer-email">
                      <strong>sales@gmail.com</strong>
                      <button 
                        className="copy-button"
                        onClick={() => {
                          navigator.clipboard.writeText('sales@gmail.com')
                          alert('Email address copied to clipboard!')
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <p className="etransfer-note">
                      Amount: <strong>{formatCurrency(totalAmount)}</strong>
                    </p>
                    <p className="etransfer-note">
                      After sending the e-transfer, click "Complete Payment" to proceed with your plan upgrade.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="payment-actions">
            <button className="cancel-button" onClick={onClose} disabled={processing}>
              Cancel
            </button>
            <button 
              className="pay-button" 
              onClick={handlePayment}
              disabled={processing || !selectedMethod}
            >
              {processing ? 'Processing...' : 'Complete Payment'}
            </button>
          </div>
        </div>
        <div className="resize-handle" onMouseDown={handleResizeStart}></div>
      </div>
    </div>
  )
}

export default PaymentModal
